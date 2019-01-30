import "./fill/require";
import * as paths from "./fill/paths";
import "./fill/storageDatabase";
import "./fill/windowsService";
import "./fill/environmentService";
import "./fill/vscodeTextmate";
import "./fill/dom";
import "./vscode.scss";
import { Client as IDEClient, IURI, IURIFactory, IProgress, INotificationHandle } from "@coder/ide";
import { registerContextMenuListener } from "vs/base/parts/contextmenu/electron-main/contextmenu";
import { LogLevel } from "vs/platform/log/common/log";
// import { RawContextKey, IContextKeyService } from "vs/platform/contextkey/common/contextkey";
import { URI } from "vs/base/common/uri";
import { INotificationService } from "vs/platform/notification/common/notification";
import { IProgressService2, ProgressLocation } from "vs/platform/progress/common/progress";
import { ExplorerItem, Model } from "vs/workbench/parts/files/common/explorerModel";
import { DragMouseEvent } from "vs/base/browser/mouseEvent";
import { IEditorService, IResourceEditor } from "vs/workbench/services/editor/common/editorService";
import { IEditorGroup } from "vs/workbench/services/group/common/editorGroupsService";
import { IWindowsService } from "vs/platform/windows/common/windows";
import { ServiceCollection } from "vs/platform/instantiation/common/serviceCollection";

export class Client extends IDEClient {

	private readonly windowId = parseInt(new Date().toISOString().replace(/[-:.TZ]/g, ""), 10);
	private _serviceCollection: ServiceCollection | undefined;

	public async handleExternalDrop(target: ExplorerItem | Model, originalEvent: DragMouseEvent): Promise<void> {
		await this.upload.uploadDropped(
			originalEvent.browserEvent as DragEvent,
			(target instanceof ExplorerItem ? target : target.roots[0]).resource,
		);
	}

	public handleDrop(event: DragEvent, resolveTargetGroup: () => IEditorGroup, afterDrop: (targetGroup: IEditorGroup) => void, targetIndex?: number): void {
		this.initData.then((d) => {
			this.upload.uploadDropped(event, URI.file(d.workingDirectory)).then((paths) => {
				const uris = paths.map((p) => URI.file(p));
				if (uris.length) {
					(this.serviceCollection.get(IWindowsService) as IWindowsService).addRecentlyOpened(uris);
				}

				const editors: IResourceEditor[] = uris.map(uri => ({
					resource: uri,
					options: {
						pinned: true,
						index: targetIndex,
					},
				}));

				const targetGroup = resolveTargetGroup();

				(this.serviceCollection.get(IEditorService) as IEditorService).openEditors(editors, targetGroup).then(() => {
					afterDrop(targetGroup);
				});
			});
		});
	}

	public get serviceCollection(): ServiceCollection {
		if (!this._serviceCollection) {
			throw new Error("Trying to access service collection before it has been set");
		}

		return this._serviceCollection;
	}

	public set serviceCollection(collection: ServiceCollection) {
		this._serviceCollection = collection;
		this.progressService = {
			start: <T>(title: string, task: (progress: IProgress) => Promise<T>, onCancel: () => void): Promise<T> => {
				let lastProgress = 0;

				return (this.serviceCollection.get(IProgressService2) as IProgressService2).withProgress({
					location: ProgressLocation.Notification,
					title,
					cancellable: true,
				}, (progress) => {
					return task({
						report: (p): void => {
							progress.report({ increment: p - lastProgress });
							lastProgress = p;
						},
					});
				}, () => {
					onCancel();
				});
			},
		};

		this.notificationService = {
			error: (error: Error): void => (this.serviceCollection.get(INotificationService) as INotificationService).error(error),
			prompt: (severity, message, buttons, onCancel): INotificationHandle => {
				const handle = (this.serviceCollection.get(INotificationService) as INotificationService).prompt(
					severity, message, buttons, { onCancel },
				);

				return {
					close: (): void => handle.close(),
					updateMessage: (message): void => handle.updateMessage(message),
					updateButtons: (buttons): void => handle.updateActions({
						primary: buttons.map((button) => ({
							id: "",
							label: button.label,
							tooltip: "",
							class: undefined,
							enabled: true,
							checked: false,
							radio: false,
							dispose: (): void => undefined,
							run: (): Promise<void> => Promise.resolve(button.run()),
						})),
					}),
				};
			},
		};
	}

	protected createUriFactory(): IURIFactory {
		return {
			// TODO: not sure why this is an error.
			// tslint:disable-next-line no-any
			create: <URI>(uri: IURI): URI => URI.from(uri) as any,
			file: (path: string): IURI => URI.file(path),
			parse: (raw: string): IURI => URI.parse(raw),
		};
	}

	protected initialize(): Promise<void> {
		registerContextMenuListener();

		const pathSets = this.sharedProcessData.then((data) => {
			paths._paths.socketPath = data.socketPath;
			process.env.VSCODE_LOGS = data.logPath;
		});

		return this.task("Start workbench", 1000, async (data) => {
			paths._paths.appData = data.dataDirectory;
			paths._paths.defaultUserData = data.dataDirectory;
			process.env.SHELL = data.shell;

			const { startup } = require("./startup");
			await startup({
				machineId: "1",
				windowId: this.windowId,
				logLevel: LogLevel.Info,
				mainPid: 1,
				appRoot: data.dataDirectory,
				execPath: data.tmpDirectory,
				userEnv: {},
				nodeCachedDataDir: data.tmpDirectory,
				perfEntries: [],
				_: [],
				folderUri: URI.file(data.workingDirectory),
			});

			// TODO: Set up clipboard context.
			// const workbench = workbenchShell.workbench;
			// const contextKeys = workbench.workbenchParams.serviceCollection.get(IContextKeyService) as IContextKeyService;
			// const clipboardContextKey = new RawContextKey("nativeClipboard", this.clipboard.isSupported);
			// const bounded = clipboardContextKey.bindTo(contextKeys);
			// this.clipboard.onPermissionChange((enabled) => {
			// 	bounded.set(enabled);
			// });
			this.clipboard.initialize();
		}, this.initData, pathSets);
	}

}

export const client = new Client();
