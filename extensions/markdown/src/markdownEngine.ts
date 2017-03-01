/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as sanitizeHtml from 'sanitize-html';
import { TableOfContentsProvider } from './tableOfContentsProvider';

export interface IToken {
	type: string;
	map: [number, number];
}

interface MarkdownIt {
	render(text: string): string;

	parse(text: string): IToken[];

	utils: any;
}

const FrontMatterRegex = /^---\s*[^]*?---\s*/;

export class MarkdownEngine {
	private md: MarkdownIt;

	private firstLine: number;

	private currentDocument: vscode.Uri;

	private get engine(): MarkdownIt {
		if (!this.md) {
			const hljs = require('highlight.js');
			const mdnh = require('markdown-it-named-headers');
			this.md = require('markdown-it')({
				html: true,
				highlight: (str: string, lang: string) => {
					if (lang && hljs.getLanguage(lang)) {
						try {
							return `<pre class="hljs"><code><div>${hljs.highlight(lang, str, true).value}</div></code></pre>`;
						} catch (error) { }
					}
					return `<pre class="hljs"><code><div>${this.engine.utils.escapeHtml(str)}</div></code></pre>`;
				}
			}).use(mdnh, {
				slugify: (header: string) => TableOfContentsProvider.slugify(header)
			});

			for (const renderName of ['paragraph_open', 'heading_open', 'image', 'code_block', 'blockquote_open', 'list_item_open']) {
				this.addLineNumberRenderer(this.md, renderName);
			}

			this.addLinkNormalizer(this.md);
			this.addLinkValidator(this.md);
		}
		return this.md;
	}

	private stripFrontmatter(text: string): { text: string, offset: number } {
		let offset = 0;
		const frontMatterMatch = FrontMatterRegex.exec(text);
		if (frontMatterMatch) {
			const frontMatter = frontMatterMatch[0];

			offset = frontMatter.split(/\r\n|\n|\r/g).length - 1;
			text = text.substr(frontMatter.length);
		}
		return { text, offset };
	}

	public render(document: vscode.Uri, stripFrontmatter: boolean, text: string): string {
		let offset = 0;
		if (stripFrontmatter) {
			const markdownContent = this.stripFrontmatter(text);
			offset = markdownContent.offset;
			text = markdownContent.text;
		}
		this.currentDocument = document;
		this.firstLine = offset;
		return this.sanitize(this.engine.render(text));
	}

	public parse(source: string): IToken[] {
		const { text, offset } = this.stripFrontmatter(source);
		return this.engine.parse(text).map(token => {
			if (token.map) {
				token.map[0] += offset;
			}
			return token;
		});
	}

	private sanitize(content: string): string {

		// Whitelist based on https://github.com/jch/html-pipeline/blob/master/lib/html/pipeline/sanitization_filter.rb
		return sanitizeHtml(content, {
			allowedTags: [
				'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'br', 'b', 'i', 'strong', 'em', 'a',
				'pre', 'code', 'img', 'tt', 'div', 'ins', 'del', 'sup', 'sub', 'p', 'ol', 'ul',
				'table', 'thead', 'tbody', 'tfoot', 'blockquote', 'dl', 'dt', 'dd', 'kbd', 'q', 'samp',
				'var', 'hr', 'ruby', 'rt', 'rp', 'li', 'tr', 'td', 'th', 's', 'strike', 'summary', 'details',
			],
			allowedAttributes: {
				'a': ['href'],
				'img': ['src', 'longdesc'],
				'div': ['itemscope', 'itemtype'],
				'blockquote': ['cite'],
				'del': ['cite'],
				'ins': ['cite'],
				'q': ['cite'],
				'*': ['abbr', 'accept', 'accept-charset',
					'accesskey', 'action', 'align', 'alt', 'axis',
					'border', 'cellpadding', 'cellspacing', 'char',
					'charoff', 'charset', 'checked',
					'clear', 'cols', 'colspan', 'color',
					'compact', 'coords', 'datetime', 'dir',
					'disabled', 'enctype', 'for', 'frame',
					'headers', 'height', 'hreflang',
					'hspace', 'ismap', 'label', 'lang',
					'maxlength', 'media', 'method',
					'multiple', 'name', 'nohref', 'noshade',
					'nowrap', 'open', 'prompt', 'readonly', 'rel', 'rev',
					'rows', 'rowspan', 'rules', 'scope',
					'selected', 'shape', 'size', 'span',
					'start', 'summary', 'tabindex', 'target',
					'title', 'type', 'usemap', 'valign', 'value',
					'vspace', 'width', 'itemprop',

					'data-*', 'class', 'id']
			},
			allowedSchemes: ['http', 'https'],
			allowedSchemesByTag: {
				'a': ['http', 'https', 'mailto'],
				'img': ['http', 'https', 'file']
			}
		} as sanitizeHtml.IOptions);
	}

	private addLineNumberRenderer(md: any, ruleName: string): void {
		const original = md.renderer.rules[ruleName];
		md.renderer.rules[ruleName] = (tokens: any, idx: number, options: any, env: any, self: any) => {
			const token = tokens[idx];
			if ((token.level === 0 || token.type === 'list_item_open' && token.level === 1) && token.map && token.map.length) {
				token.attrSet('data-line', this.firstLine + token.map[0]);
				token.attrJoin('class', 'code-line');
			}
			if (original) {
				return original(tokens, idx, options, env, self);
			} else {
				return self.renderToken(tokens, idx, options, env, self);
			}
		};
	}

	private addLinkNormalizer(md: any): void {
		const normalizeLink = md.normalizeLink;
		md.normalizeLink = (link: string) => {
			try {
				let uri = vscode.Uri.parse(link);
				if (!uri.scheme && uri.path && !uri.fragment) {
					// Assume it must be a file
					if (uri.path[0] === '/') {
						uri = vscode.Uri.file(path.join(vscode.workspace.rootPath || '', uri.path));
					} else {
						uri = vscode.Uri.file(path.join(path.dirname(this.currentDocument.path), uri.path));
					}
					return normalizeLink(uri.toString(true));
				}
			} catch (e) {
				// noop
			}
			return normalizeLink(link);
		};
	}

	private addLinkValidator(md: any): void {
		const validateLink = md.validateLink;
		md.validateLink = (link: string) => {
			// support file:// links
			return validateLink(link) || link.indexOf('file:') === 0;
		};
	}
}