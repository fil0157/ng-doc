import * as minimatch from 'minimatch';
import * as path from 'path';
import {forkJoin, merge, Observable, of} from 'rxjs';
import {finalize, map, startWith, switchMap, tap} from 'rxjs/operators';
import {Constructor, Project, SourceFile} from 'ts-morph';

import {asArray} from '../helpers';
import {NgDocBuilderContext} from '../interfaces';
import {bufferDebounce} from '../operators';
import {NgDocBuildable} from './buildables/buildable';
import {NgDocCategoryPoint} from './buildables/category';
import {NgDocPagePoint} from './buildables/page';
import {NgDocPageDependenciesPoint} from './buildables/page-dependencies';
import {CATEGORY_PATTERN, PAGE_DEPENDENCY_PATTERN, PAGE_PATTERN} from './variables';
import {NgDocWatcher} from './watcher';

export class NgDocBuildableStore implements Iterable<NgDocBuildable> {
	private readonly watcher: NgDocWatcher;
	private buildables: Map<string, NgDocBuildable> = new Map();

	constructor(private readonly context: NgDocBuilderContext, private readonly project: Project) {
		this.watcher = new NgDocWatcher(
			asArray(this.context.options.ngDoc.pages)
				.map((pagesPath: string) => [
					path.join(pagesPath, PAGE_PATTERN),
					path.join(pagesPath, CATEGORY_PATTERN),
					path.join(pagesPath, PAGE_DEPENDENCY_PATTERN),
				])
				.flat(),
		);
	}

	*[Symbol.iterator](): Iterator<NgDocBuildable> {
		for (const value of asArray(this.buildables.values())) {
			yield value;
		}
	}

	get changes(): Observable<NgDocBuildable[]> {
		return merge(this.add(), this.update(), this.remove().pipe(map(asArray))).pipe(
			switchMap((buildables: NgDocBuildable[]) =>
				buildables.length
					? forkJoin(...buildables.map((buildable: NgDocBuildable) => buildable.emit())).pipe(
							map(() => buildables),
					  )
					: of(buildables),
			),
			tap((buildables: NgDocBuildable[]) =>
				buildables.forEach((buildable: NgDocBuildable) => buildable.update()),
			),
			switchMap((buildables: NgDocBuildable[]) =>
				merge(...asArray(this).map((buildable: NgDocBuildable) => buildable.needToRebuild)).pipe(
					bufferDebounce(50),
					startWith(this.getBuildCandidates(buildables)),
				),
			),
			finalize(() => this.watcher.close()),
		);
	}

	get rootBuildablesForBuild(): NgDocBuildable[] {
		return asArray(this.buildables.values()).filter(
			(buildable: NgDocBuildable) => buildable.isRoot && buildable.isReadyToBuild,
		);
	}

	get(path: string): NgDocBuildable | undefined {
		return this.buildables.get(path);
	}

	has(path: string): boolean {
		return this.buildables.has(path);
	}

	private add(): Observable<NgDocBuildable[]> {
		return this.watcher.add.pipe(
			map((paths: string[]) => {
				const newBuildables: NgDocBuildable[] = [];

				for (const buildablePath of paths) {
					if (!this.buildables.get(buildablePath)) {
						const sourceFile: SourceFile = this.project.addSourceFileAtPath(buildablePath);
						const Constructor: Constructor<NgDocBuildable> = this.getBuildableConstructor(buildablePath);
						const newBuildable: NgDocBuildable = new Constructor(this.context, this.buildables, sourceFile);

						newBuildables.push(newBuildable);
						this.buildables.set(buildablePath, newBuildable);
					}
				}

				return newBuildables;
			}),
		);
	}

	private update(): Observable<NgDocBuildable[]> {
		return this.watcher.update.pipe(
			map((path: string) => {
				const buildable: NgDocBuildable | undefined = this.buildables.get(path);

				if (!buildable) {
					throw new Error(`Buildable not found: ${path}`);
				}

				this.project.getSourceFile(path)?.refreshFromFileSystemSync();

				return [buildable];
			}),
		);
	}

	private remove(): Observable<NgDocBuildable | undefined> {
		return this.watcher.remove.pipe(
			map((path: string) => {
				const buildable: NgDocBuildable | undefined = this.buildables.get(path);

				if (!buildable) {
					throw new Error(`Buildable not found: ${path}`);
				}

				const parent: NgDocBuildable | undefined = buildable.parent;

				buildable?.destroy();
				this.buildables.delete(path);

				// we return parent buildable if we have it because we want to rebuild it when his child is removed
				return parent;
			}),
		);
	}

	private getBuildableConstructor(path: string): Constructor<NgDocBuildable> {
		if (minimatch(path, PAGE_PATTERN)) {
			return NgDocPagePoint;
		} else if (minimatch(path, CATEGORY_PATTERN)) {
			return NgDocCategoryPoint;
		} else if (minimatch(path, PAGE_DEPENDENCY_PATTERN)) {
			return NgDocPageDependenciesPoint;
		} else {
			throw new Error(`Unknown buildable type for path: ${path}`);
		}
	}

	private getBuildCandidates(buildables: NgDocBuildable | NgDocBuildable[]): NgDocBuildable[] {
		return asArray(
			new Set(
				asArray(buildables)
					.map((buildable: NgDocBuildable) => [buildable, ...buildable.buildCandidates])
					.flat(),
			),
		);
	}

	private isDependencies(path: string): boolean {
		return minimatch(path, PAGE_DEPENDENCY_PATTERN);
	}
}
