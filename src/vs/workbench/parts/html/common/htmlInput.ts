/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import URI from 'vs/base/common/uri';
import { ITextModelResolverService } from 'vs/editor/common/services/resolverService';

/**
 * Marker class
 */
export class HtmlInput extends ResourceEditorInput {
	constructor(
		name: string,
		description: string,
		resource: URI,
		public readonly nodeIntegration: boolean,
		@ITextModelResolverService textModelResolverService: ITextModelResolverService
	) {
		super(name, description, resource, textModelResolverService);
	}
}
