/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { ILaunchChannel } from 'vs/code/electron-main/launch';

export async function uploadLogs(
	channel: ILaunchChannel
): Promise<any> {
	const cp = await import('child_process');
	const fs = await import('fs');
	const os = await import('os');
	const path = await import('path');

	const logsPath = await channel.call('get-logs-path', null);
	console.log(logsPath);
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-log-upload'));
	const outZip = path.join(tempDir, 'logs.zip');
	await new Promise((resolve, reject) => {
		cp.execFile('zip', ['-r', outZip, '.'], { cwd: logsPath }, (err, stdout, stderr) => {
			if (err) {
				console.error(err);
				reject(err);
				return;
			}
			console.log(outZip);
			resolve(outZip);
		});
	});
	return;
	const http = await import('https');
	return new Promise((resolve, reject) => {
		const req = http.request({
			host: 'vscode-log-uploader.azure-api.net',
			path: '/v1/upload',
			method: 'POST',
			headers: {
				'Content-Type': 'application/zip',
				'Content-Length': fs.statSync(logsPath).size
			}
		}, res => {
			res.on('data', (chunk) => {
				console.log(`BODY: ${chunk}`);
			});
			res.on('end', () => {
				console.log('No more data in response.');
				resolve('fsadfasd');
			});
		});
		fs.createReadStream(outZip).pipe(req);
	});
}