import { NgDocPlaygroundControlConfig, NgDocPlaygroundProperties } from '@ng-doc/core';
import path from 'path';
import { Observable, of } from 'rxjs';
import { ObjectLiteralExpression } from 'ts-morph';

import {
	buildPlaygroundMetadata,
	getPlaygroundById,
	getPlaygroundsExpression,
	getPlaygroundsIds,
} from '../../helpers';
import { NgDocBuilderContext, NgDocBuildResult, NgDocPlaygroundMetadata } from '../../interfaces';
import { NgDocEntityStore } from '../entity-store';
import { renderTemplate } from '../nunjucks';
import { NgDocEntity } from './abstractions/entity';
import { CachedFilesGetter, NgDocCache } from './cache';
import { NgDocPageEntity } from './page.entity';

export class NgDocPagePlaygroundEntity extends NgDocEntity {
	override id: string = `${this.parent.id}#playground`;
	override isRoot: boolean = false;
	metadata: Record<string, NgDocPlaygroundMetadata> = {};

	constructor(
		override readonly store: NgDocEntityStore,
		override readonly cache: NgDocCache,
		override readonly context: NgDocBuilderContext,
		readonly parent: NgDocPageEntity,
	) {
		super(store, cache, context);
	}

	override get rootFiles(): string[] {
		return [];
	}

	override get buildCandidates(): NgDocEntity[] {
		return [this.parent];
	}

	@CachedFilesGetter()
	get outputPath(): string {
		return path.join(this.parent.folderPath, 'playgrounds.ts');
	}

	build(): Observable<NgDocBuildResult<string, this>> {
		this.metadata = this.getMetadata();

		const result: string = renderTemplate('./playgrounds.ts.nunj', {
			context: {
				playgroundMetadata: this.metadata,
				hasImports: this.parent.hasImports,
				targetImportPath: this.parent.importPath,
			},
		});

		return of({
			result,
			entity: this,
			toBuilderOutput: async (content: string) => ({
				content,
				filePath: this.outputPath,
			}),
		});
	}

	private getMetadata(): Record<string, NgDocPlaygroundMetadata> {
		const page = this.parent.target;

		if (this.parent.objectExpression && page) {
			this.parent.refreshDependencies();

			const expression = getPlaygroundsExpression(this.parent.objectExpression);

			if (expression) {
				return getPlaygroundsIds(expression).reduce(
					(metadata: Record<string, NgDocPlaygroundMetadata>, id: string) => {
						if (expression) {
							const playground: ObjectLiteralExpression | undefined = getPlaygroundById(
								expression,
								id,
							);

							if (playground) {
								metadata[id] = buildPlaygroundMetadata(
									id,
									playground,
									this.controlsToProperties(page.playgrounds?.[id]?.controls ?? {}),
								);
							}
						}
						return metadata;
					},
					{},
				);
			}
		}

		return {};
	}

	private controlsToProperties(
		controls: Record<string, string | NgDocPlaygroundControlConfig>,
	): NgDocPlaygroundProperties {
		return Object.entries(controls).reduce(
			(
				properties: NgDocPlaygroundProperties,
				[name, value]: [string, string | NgDocPlaygroundControlConfig],
			) => {
				properties[name] = {
					inputName: typeof value === 'string' ? name : value.alias ?? name,
					type: typeof value === 'string' ? value : value.type,
					description: typeof value === 'string' ? undefined : value.description ?? undefined,
					options: typeof value === 'string' ? undefined : value.options ?? undefined,
				};

				return properties;
			},
			{},
		);
	}
}
