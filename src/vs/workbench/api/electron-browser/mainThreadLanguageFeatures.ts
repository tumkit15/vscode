/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';
import { ITextModel, ISingleEditOperation } from 'vs/editor/common/model';
import * as modes from 'vs/editor/common/modes';
import * as search from 'vs/workbench/contrib/search/common/search';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Position as EditorPosition } from 'vs/editor/common/core/position';
import { Range as EditorRange } from 'vs/editor/common/core/range';
import { ExtHostContext, MainThreadLanguageFeaturesShape, ExtHostLanguageFeaturesShape, MainContext, IExtHostContext, ISerializedLanguageConfiguration, ISerializedRegExp, ISerializedIndentationRule, ISerializedOnEnterRule, LocationDto, WorkspaceSymbolDto, CodeActionDto, reviveWorkspaceEditDto, ISerializedDocumentFilter, DefinitionLinkDto, ISerializedSignatureHelpProviderMetadata, CodeInsetDto, LinkDto } from '../node/extHost.protocol';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { LanguageConfiguration, IndentationRule, OnEnterRule } from 'vs/editor/common/modes/languageConfiguration';
import { IHeapService } from './mainThreadHeapService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { extHostNamedCustomer } from 'vs/workbench/api/electron-browser/extHostCustomers';
import * as typeConverters from 'vs/workbench/api/node/extHostTypeConverters';
import { URI } from 'vs/base/common/uri';
import { Selection } from 'vs/editor/common/core/selection';
import * as codeInset from 'vs/workbench/contrib/codeinset/common/codeInset';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';

@extHostNamedCustomer(MainContext.MainThreadLanguageFeatures)
export class MainThreadLanguageFeatures implements MainThreadLanguageFeaturesShape {

	private readonly _proxy: ExtHostLanguageFeaturesShape;
	private readonly _heapService: IHeapService;
	private readonly _modeService: IModeService;
	private readonly _registrations: { [handle: number]: IDisposable; } = Object.create(null);

	constructor(
		extHostContext: IExtHostContext,
		@IHeapService heapService: IHeapService,
		@IModeService modeService: IModeService,
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostLanguageFeatures);
		this._heapService = heapService;
		this._modeService = modeService;
	}

	dispose(): void {
		for (const key in this._registrations) {
			this._registrations[key].dispose();
		}
	}

	$unregister(handle: number): void {
		const registration = this._registrations[handle];
		if (registration) {
			registration.dispose();
			delete this._registrations[handle];
		}
	}

	//#region --- revive functions

	private static _reviveLocationDto(data: LocationDto): modes.Location;
	private static _reviveLocationDto(data: LocationDto[]): modes.Location[];
	private static _reviveLocationDto(data: LocationDto | LocationDto[]): modes.Location | modes.Location[] {
		if (!data) {
			return <modes.Location>data;
		} else if (Array.isArray(data)) {
			data.forEach(l => MainThreadLanguageFeatures._reviveLocationDto(l));
			return <modes.Location[]>data;
		} else {
			data.uri = URI.revive(data.uri);
			return <modes.Location>data;
		}
	}

	private static _reviveLocationLinkDto(data: DefinitionLinkDto): modes.LocationLink;
	private static _reviveLocationLinkDto(data: DefinitionLinkDto[]): modes.LocationLink[];
	private static _reviveLocationLinkDto(data: DefinitionLinkDto | DefinitionLinkDto[]): modes.LocationLink | modes.LocationLink[] {
		if (!data) {
			return <modes.LocationLink>data;
		} else if (Array.isArray(data)) {
			data.forEach(l => MainThreadLanguageFeatures._reviveLocationLinkDto(l));
			return <modes.LocationLink[]>data;
		} else {
			data.uri = URI.revive(data.uri);
			return <modes.LocationLink>data;
		}
	}

	private static _reviveWorkspaceSymbolDto(data: WorkspaceSymbolDto): search.IWorkspaceSymbol;
	private static _reviveWorkspaceSymbolDto(data: WorkspaceSymbolDto[]): search.IWorkspaceSymbol[];
	private static _reviveWorkspaceSymbolDto(data: undefined): undefined;
	private static _reviveWorkspaceSymbolDto(data: WorkspaceSymbolDto | WorkspaceSymbolDto[] | undefined): search.IWorkspaceSymbol | search.IWorkspaceSymbol[] | undefined {
		if (!data) {
			return <undefined>data;
		} else if (Array.isArray(data)) {
			data.forEach(MainThreadLanguageFeatures._reviveWorkspaceSymbolDto);
			return <search.IWorkspaceSymbol[]>data;
		} else {
			data.location = MainThreadLanguageFeatures._reviveLocationDto(data.location);
			return <search.IWorkspaceSymbol>data;
		}
	}

	private static _reviveCodeActionDto(data: CodeActionDto[] | undefined): modes.CodeAction[] {
		if (data) {
			data.forEach(code => reviveWorkspaceEditDto(code.edit));
		}
		return <modes.CodeAction[]>data;
	}

	private static _reviveLinkDTO(data: LinkDto): modes.ILink {
		if (data.url && typeof data.url !== 'string') {
			data.url = URI.revive(data.url);
		}
		return <modes.ILink>data;
	}

	//#endregion

	// --- outline

	$registerDocumentSymbolProvider(handle: number, selector: ISerializedDocumentFilter[], displayName: string): void {
		this._registrations[handle] = modes.DocumentSymbolProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.DocumentSymbolProvider>{
			displayName,
			provideDocumentSymbols: (model: ITextModel, token: CancellationToken): Promise<modes.DocumentSymbol[] | undefined> => {
				return this._proxy.$provideDocumentSymbols(handle, model.uri, token);
			}
		});
	}

	// --- code lens

	$registerCodeLensSupport(handle: number, selector: ISerializedDocumentFilter[], eventHandle: number | undefined): void {

		const provider = <modes.CodeLensProvider>{
			provideCodeLenses: (model: ITextModel, token: CancellationToken): modes.ICodeLensSymbol[] | Promise<modes.ICodeLensSymbol[]> => {
				return this._proxy.$provideCodeLenses(handle, model.uri, token).then(dto => {
					if (dto) {
						dto.forEach(obj => {
							this._heapService.trackObject(obj);
							if (obj.command) {
								this._heapService.trackObject(obj.command);
							}
						});
					}
					return dto;
				});
			},
			resolveCodeLens: (model: ITextModel, codeLens: modes.ICodeLensSymbol, token: CancellationToken): Promise<modes.ICodeLensSymbol | undefined> => {
				return this._proxy.$resolveCodeLens(handle, model.uri, codeLens, token).then(obj => {
					if (obj) {
						this._heapService.trackObject(obj);
						if (obj.command) {
							this._heapService.trackObject(obj.command);
						}
					}
					return obj;
				});
			}
		};

		if (typeof eventHandle === 'number') {
			const emitter = new Emitter<modes.CodeLensProvider>();
			this._registrations[eventHandle] = emitter;
			provider.onDidChange = emitter.event;
		}

		this._registrations[handle] = modes.CodeLensProviderRegistry.register(typeConverters.LanguageSelector.from(selector), provider);
	}

	$emitCodeLensEvent(eventHandle: number, event?: any): void {
		const obj = this._registrations[eventHandle];
		if (obj instanceof Emitter) {
			obj.fire(event);
		}
	}

	// -- code inset

	$registerCodeInsetSupport(handle: number, selector: ISerializedDocumentFilter[], eventHandle: number): void {

		const provider = <codeInset.CodeInsetProvider>{
			provideCodeInsets: (model: ITextModel, token: CancellationToken): CodeInsetDto[] | Thenable<CodeInsetDto[]> => {
				return this._proxy.$provideCodeInsets(handle, model.uri, token).then(dto => {
					if (dto) { dto.forEach(obj => this._heapService.trackObject(obj)); }
					return dto;
				});
			},
			resolveCodeInset: (model: ITextModel, codeInset: CodeInsetDto, token: CancellationToken): CodeInsetDto | Thenable<CodeInsetDto> => {
				return this._proxy.$resolveCodeInset(handle, model.uri, codeInset, token).then(obj => {
					this._heapService.trackObject(obj);
					return obj;
				});
			}
		};

		if (typeof eventHandle === 'number') {
			const emitter = new Emitter<codeInset.CodeInsetProvider>();
			this._registrations[eventHandle] = emitter;
			provider.onDidChange = emitter.event;
		}

		const langSelector = typeConverters.LanguageSelector.from(selector);
		this._registrations[handle] = codeInset.CodeInsetProviderRegistry.register(langSelector, provider);
	}

	// --- declaration

	$registerDefinitionSupport(handle: number, selector: ISerializedDocumentFilter[]): void {
		this._registrations[handle] = modes.DefinitionProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.DefinitionProvider>{
			provideDefinition: (model, position, token): Promise<modes.LocationLink[]> => {
				return this._proxy.$provideDefinition(handle, model.uri, position, token).then(MainThreadLanguageFeatures._reviveLocationLinkDto);
			}
		});
	}

	$registerDeclarationSupport(handle: number, selector: ISerializedDocumentFilter[]): void {
		this._registrations[handle] = modes.DeclarationProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.DeclarationProvider>{
			provideDeclaration: (model, position, token) => {
				return this._proxy.$provideDeclaration(handle, model.uri, position, token).then(MainThreadLanguageFeatures._reviveLocationLinkDto);
			}
		});
	}

	$registerImplementationSupport(handle: number, selector: ISerializedDocumentFilter[]): void {
		this._registrations[handle] = modes.ImplementationProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.ImplementationProvider>{
			provideImplementation: (model, position, token): Promise<modes.LocationLink[]> => {
				return this._proxy.$provideImplementation(handle, model.uri, position, token).then(MainThreadLanguageFeatures._reviveLocationLinkDto);
			}
		});
	}

	$registerTypeDefinitionSupport(handle: number, selector: ISerializedDocumentFilter[]): void {
		this._registrations[handle] = modes.TypeDefinitionProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.TypeDefinitionProvider>{
			provideTypeDefinition: (model, position, token): Promise<modes.LocationLink[]> => {
				return this._proxy.$provideTypeDefinition(handle, model.uri, position, token).then(MainThreadLanguageFeatures._reviveLocationLinkDto);
			}
		});
	}

	// --- extra info

	$registerHoverProvider(handle: number, selector: ISerializedDocumentFilter[]): void {
		this._registrations[handle] = modes.HoverProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.HoverProvider>{
			provideHover: (model: ITextModel, position: EditorPosition, token: CancellationToken): Promise<modes.Hover | undefined> => {
				return this._proxy.$provideHover(handle, model.uri, position, token);
			}
		});
	}

	// --- occurrences

	$registerDocumentHighlightProvider(handle: number, selector: ISerializedDocumentFilter[]): void {
		this._registrations[handle] = modes.DocumentHighlightProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.DocumentHighlightProvider>{
			provideDocumentHighlights: (model: ITextModel, position: EditorPosition, token: CancellationToken): Promise<modes.DocumentHighlight[] | undefined> => {
				return this._proxy.$provideDocumentHighlights(handle, model.uri, position, token);
			}
		});
	}

	// --- references

	$registerReferenceSupport(handle: number, selector: ISerializedDocumentFilter[]): void {
		this._registrations[handle] = modes.ReferenceProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.ReferenceProvider>{
			provideReferences: (model: ITextModel, position: EditorPosition, context: modes.ReferenceContext, token: CancellationToken): Promise<modes.Location[]> => {
				return this._proxy.$provideReferences(handle, model.uri, position, context, token).then(MainThreadLanguageFeatures._reviveLocationDto);
			}
		});
	}

	// --- quick fix

	$registerQuickFixSupport(handle: number, selector: ISerializedDocumentFilter[], providedCodeActionKinds?: string[]): void {
		this._registrations[handle] = modes.CodeActionProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.CodeActionProvider>{
			provideCodeActions: (model: ITextModel, rangeOrSelection: EditorRange | Selection, context: modes.CodeActionContext, token: CancellationToken): Promise<modes.CodeAction[]> => {
				return this._proxy.$provideCodeActions(handle, model.uri, rangeOrSelection, context, token).then(dto => {
					if (dto) {
						dto.forEach(obj => {
							if (obj.command) {
								this._heapService.trackObject(obj.command);
							}
						});
					}
					return MainThreadLanguageFeatures._reviveCodeActionDto(dto);
				});
			},
			providedCodeActionKinds
		});
	}

	// --- formatting

	$registerDocumentFormattingSupport(handle: number, selector: ISerializedDocumentFilter[], extensionId: ExtensionIdentifier): void {
		this._registrations[handle] = modes.DocumentFormattingEditProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.DocumentFormattingEditProvider>{
			extensionId,
			provideDocumentFormattingEdits: (model: ITextModel, options: modes.FormattingOptions, token: CancellationToken): Promise<ISingleEditOperation[] | undefined> => {
				return this._proxy.$provideDocumentFormattingEdits(handle, model.uri, options, token);
			}
		});
	}

	$registerRangeFormattingSupport(handle: number, selector: ISerializedDocumentFilter[], extensionId: ExtensionIdentifier): void {
		this._registrations[handle] = modes.DocumentRangeFormattingEditProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.DocumentRangeFormattingEditProvider>{
			extensionId,
			provideDocumentRangeFormattingEdits: (model: ITextModel, range: EditorRange, options: modes.FormattingOptions, token: CancellationToken): Promise<ISingleEditOperation[] | undefined> => {
				return this._proxy.$provideDocumentRangeFormattingEdits(handle, model.uri, range, options, token);
			}
		});
	}

	$registerOnTypeFormattingSupport(handle: number, selector: ISerializedDocumentFilter[], autoFormatTriggerCharacters: string[], extensionId: ExtensionIdentifier): void {
		this._registrations[handle] = modes.OnTypeFormattingEditProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.OnTypeFormattingEditProvider>{
			extensionId,
			autoFormatTriggerCharacters,
			provideOnTypeFormattingEdits: (model: ITextModel, position: EditorPosition, ch: string, options: modes.FormattingOptions, token: CancellationToken): Promise<ISingleEditOperation[] | undefined> => {
				return this._proxy.$provideOnTypeFormattingEdits(handle, model.uri, position, ch, options, token);
			}
		});
	}

	// --- navigate type

	$registerNavigateTypeSupport(handle: number): void {
		let lastResultId: number | undefined;
		this._registrations[handle] = search.WorkspaceSymbolProviderRegistry.register(<search.IWorkspaceSymbolProvider>{
			provideWorkspaceSymbols: (search: string, token: CancellationToken): Promise<search.IWorkspaceSymbol[]> => {
				return this._proxy.$provideWorkspaceSymbols(handle, search, token).then(result => {
					if (lastResultId !== undefined) {
						this._proxy.$releaseWorkspaceSymbols(handle, lastResultId);
					}
					lastResultId = result._id;
					return MainThreadLanguageFeatures._reviveWorkspaceSymbolDto(result.symbols);
				});
			},
			resolveWorkspaceSymbol: (item: search.IWorkspaceSymbol, token: CancellationToken): Promise<search.IWorkspaceSymbol | undefined> => {
				return this._proxy.$resolveWorkspaceSymbol(handle, item, token).then(i => {
					if (i) {
						return MainThreadLanguageFeatures._reviveWorkspaceSymbolDto(i);
					}
					return undefined;
				});
			}
		});
	}

	// --- rename

	$registerRenameSupport(handle: number, selector: ISerializedDocumentFilter[], supportResolveLocation: boolean): void {

		this._registrations[handle] = modes.RenameProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.RenameProvider>{
			provideRenameEdits: (model: ITextModel, position: EditorPosition, newName: string, token: CancellationToken): Promise<modes.WorkspaceEdit> => {
				return this._proxy.$provideRenameEdits(handle, model.uri, position, newName, token).then(reviveWorkspaceEditDto);
			},
			resolveRenameLocation: supportResolveLocation
				? (model: ITextModel, position: EditorPosition, token: CancellationToken): Promise<modes.RenameLocation | undefined> => this._proxy.$resolveRenameLocation(handle, model.uri, position, token)
				: undefined
		});
	}

	// --- suggest

	$registerSuggestSupport(handle: number, selector: ISerializedDocumentFilter[], triggerCharacters: string[], supportsResolveDetails: boolean): void {
		this._registrations[handle] = modes.CompletionProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.CompletionItemProvider>{
			triggerCharacters,
			provideCompletionItems: (model: ITextModel, position: EditorPosition, context: modes.CompletionContext, token: CancellationToken): Promise<modes.CompletionList | undefined> => {
				return this._proxy.$provideCompletionItems(handle, model.uri, position, context, token).then(result => {
					if (!result) {
						return result;
					}
					return {
						suggestions: result.suggestions,
						incomplete: result.incomplete,
						dispose: () => {
							if (typeof result._id === 'number') {
								this._proxy.$releaseCompletionItems(handle, result._id);
							}
						}
					};
				});
			},
			resolveCompletionItem: supportsResolveDetails
				? (model, position, suggestion, token) => this._proxy.$resolveCompletionItem(handle, model.uri, position, suggestion, token)
				: undefined
		});
	}

	// --- parameter hints

	$registerSignatureHelpProvider(handle: number, selector: ISerializedDocumentFilter[], metadata: ISerializedSignatureHelpProviderMetadata): void {
		this._registrations[handle] = modes.SignatureHelpProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.SignatureHelpProvider>{

			signatureHelpTriggerCharacters: metadata.triggerCharacters,
			signatureHelpRetriggerCharacters: metadata.retriggerCharacters,

			provideSignatureHelp: (model: ITextModel, position: EditorPosition, token: CancellationToken, context: modes.SignatureHelpContext): Promise<modes.SignatureHelp | undefined> => {
				return this._proxy.$provideSignatureHelp(handle, model.uri, position, context, token);
			}
		});
	}

	// --- links

	$registerDocumentLinkProvider(handle: number, selector: ISerializedDocumentFilter[]): void {
		this._registrations[handle] = modes.LinkProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.LinkProvider>{
			provideLinks: (model, token) => {
				return this._proxy.$provideDocumentLinks(handle, model.uri, token).then(dto => {
					if (dto) {
						dto.forEach(obj => {
							MainThreadLanguageFeatures._reviveLinkDTO(obj);
							this._heapService.trackObject(obj);
						});
					}
					return dto;
				});
			},
			resolveLink: (link, token) => {
				return this._proxy.$resolveDocumentLink(handle, link, token).then(obj => {
					if (obj) {
						MainThreadLanguageFeatures._reviveLinkDTO(obj);
						this._heapService.trackObject(obj);
					}
					return obj;
				});
			}
		});
	}

	// --- colors

	$registerDocumentColorProvider(handle: number, selector: ISerializedDocumentFilter[]): void {
		const proxy = this._proxy;
		this._registrations[handle] = modes.ColorProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.DocumentColorProvider>{
			provideDocumentColors: (model, token) => {
				return proxy.$provideDocumentColors(handle, model.uri, token)
					.then(documentColors => {
						return documentColors.map(documentColor => {
							const [red, green, blue, alpha] = documentColor.color;
							const color = {
								red: red,
								green: green,
								blue: blue,
								alpha
							};

							return {
								color,
								range: documentColor.range
							};
						});
					});
			},

			provideColorPresentations: (model, colorInfo, token) => {
				return proxy.$provideColorPresentations(handle, model.uri, {
					color: [colorInfo.color.red, colorInfo.color.green, colorInfo.color.blue, colorInfo.color.alpha],
					range: colorInfo.range
				}, token);
			}
		});
	}

	// --- folding

	$registerFoldingRangeProvider(handle: number, selector: ISerializedDocumentFilter[]): void {
		const proxy = this._proxy;
		this._registrations[handle] = modes.FoldingRangeProviderRegistry.register(typeConverters.LanguageSelector.from(selector), <modes.FoldingRangeProvider>{
			provideFoldingRanges: (model, context, token) => {
				return proxy.$provideFoldingRanges(handle, model.uri, context, token);
			}
		});
	}

	// -- smart select

	$registerSelectionRangeProvider(handle: number, selector: ISerializedDocumentFilter[]): void {
		this._registrations[handle] = modes.SelectionRangeRegistry.register(typeConverters.LanguageSelector.from(selector), {
			provideSelectionRanges: (model, positions, token) => {
				return this._proxy.$provideSelectionRanges(handle, model.uri, positions, token);
			}
		});
	}

	// --- configuration

	private static _reviveRegExp(regExp: ISerializedRegExp): RegExp {
		return new RegExp(regExp.pattern, regExp.flags);
	}

	private static _reviveIndentationRule(indentationRule: ISerializedIndentationRule): IndentationRule {
		return {
			decreaseIndentPattern: MainThreadLanguageFeatures._reviveRegExp(indentationRule.decreaseIndentPattern),
			increaseIndentPattern: MainThreadLanguageFeatures._reviveRegExp(indentationRule.increaseIndentPattern),
			indentNextLinePattern: indentationRule.indentNextLinePattern ? MainThreadLanguageFeatures._reviveRegExp(indentationRule.indentNextLinePattern) : undefined,
			unIndentedLinePattern: indentationRule.unIndentedLinePattern ? MainThreadLanguageFeatures._reviveRegExp(indentationRule.unIndentedLinePattern) : undefined,
		};
	}

	private static _reviveOnEnterRule(onEnterRule: ISerializedOnEnterRule): OnEnterRule {
		return {
			beforeText: MainThreadLanguageFeatures._reviveRegExp(onEnterRule.beforeText),
			afterText: onEnterRule.afterText ? MainThreadLanguageFeatures._reviveRegExp(onEnterRule.afterText) : undefined,
			oneLineAboveText: onEnterRule.oneLineAboveText ? MainThreadLanguageFeatures._reviveRegExp(onEnterRule.oneLineAboveText) : undefined,
			action: onEnterRule.action
		};
	}

	private static _reviveOnEnterRules(onEnterRules: ISerializedOnEnterRule[]): OnEnterRule[] {
		return onEnterRules.map(MainThreadLanguageFeatures._reviveOnEnterRule);
	}

	$setLanguageConfiguration(handle: number, languageId: string, _configuration: ISerializedLanguageConfiguration): void {

		const configuration: LanguageConfiguration = {
			comments: _configuration.comments,
			brackets: _configuration.brackets,
			wordPattern: _configuration.wordPattern ? MainThreadLanguageFeatures._reviveRegExp(_configuration.wordPattern) : undefined,
			indentationRules: _configuration.indentationRules ? MainThreadLanguageFeatures._reviveIndentationRule(_configuration.indentationRules) : undefined,
			onEnterRules: _configuration.onEnterRules ? MainThreadLanguageFeatures._reviveOnEnterRules(_configuration.onEnterRules) : undefined,

			autoClosingPairs: undefined,
			surroundingPairs: undefined,
			__electricCharacterSupport: undefined
		};

		if (_configuration.__characterPairSupport) {
			// backwards compatibility
			configuration.autoClosingPairs = _configuration.__characterPairSupport.autoClosingPairs;
		}

		if (_configuration.__electricCharacterSupport && _configuration.__electricCharacterSupport.docComment) {
			configuration.__electricCharacterSupport = {
				docComment: {
					open: _configuration.__electricCharacterSupport.docComment.open,
					close: _configuration.__electricCharacterSupport.docComment.close
				}
			};
		}

		const languageIdentifier = this._modeService.getLanguageIdentifier(languageId);
		if (languageIdentifier) {
			this._registrations[handle] = LanguageConfigurationRegistry.register(languageIdentifier, configuration);
		}
	}

}
