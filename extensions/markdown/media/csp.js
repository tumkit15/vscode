/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

(function () {
	const settings = JSON.parse(document.getElementById('vscode-markdown-preview-settings').getAttribute('data-settings'));

	let didShow = false;

	document.addEventListener('securitypolicyviolation', () => {
		if (didShow) {
			return;
		}
		didShow = true;
		const args = [settings.previewUri];

		const notification = document.createElement('a');
		notification.innerText = 'Document contains scripts which have been disabled';
		notification.setAttribute('id', 'code-csp-warning');
		notification.setAttribute('title', 'Document contains scripts');

		notification.setAttribute('role', 'button');
		notification.setAttribute('aria-label', 'Security Warning');
		notification.setAttribute('href', `command:markdown.showPreviewSecuritySelector?${encodeURIComponent(JSON.stringify(args))}`);

		document.body.appendChild(notification);
	});
}());