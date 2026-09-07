import type { IpcMainInvokeEvent, Session, WebContents } from "electron";

/** The single renderer allowed to make privileged calls. Registered at window creation. */
let trustedWebContentsId: number | null = null;
let trustedMatcher: ((url: string) => boolean) | null = null;
let trustedLabel = "(none)";

/**
 * `matches` decides whether a URL is XENIUR's own interface.
 *
 * It is a predicate rather than an origin string because a packaged app is served from
 * file://, and `new URL("file:///…").origin` is the string "null" — comparing origins
 * there rejects the app's own renderer. Dev and production need different tests, so the
 * caller supplies the right one.
 */
export function registerTrustedRenderer(
  contents: WebContents, matches: (url: string) => boolean, label: string,
): void {
  trustedWebContentsId = contents.id;
  trustedMatcher = matches;
  trustedLabel = label;
}

export class UntrustedSenderError extends Error {
  readonly code = "untrusted_sender" as const;
  constructor(reason: string, readonly origin: string) {
    super(`refused IPC from an untrusted sender: ${reason}`);
    this.name = "UntrustedSenderError";
  }
}

const describe = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null" ? `${parsed.protocol}//${parsed.pathname}` : parsed.origin;
  } catch { return url; }
};

/**
 * Validating the payload is not enough — Electron's own guidance is to check who sent an
 * IPC message, because a compromised or unexpected frame can call any exposed channel.
 * So every privileged handler answers "who is asking?" before "what are they asking?".
 *
 * Untrusted views get no preload and therefore have no channels at all; this is defence
 * in depth for the day a bug or a new feature attaches one.
 */
export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  const url = frame?.url ?? event.sender.getURL();
  const where = describe(url);

  if (!frame) throw new UntrustedSenderError("the sending frame is gone", where);
  if (frame.parent !== null) throw new UntrustedSenderError("only a main frame may call in", where);
  if (trustedWebContentsId === null || trustedMatcher === null) {
    throw new UntrustedSenderError("no trusted renderer is registered", where);
  }
  if (event.sender.id !== trustedWebContentsId) {
    throw new UntrustedSenderError("this is not XENIUR's own renderer", where);
  }
  if (!trustedMatcher(url)) {
    throw new UntrustedSenderError(`${where} is not ${trustedLabel}`, where);
  }
  // A browsing partition must never be able to reach a privileged handler, whatever
  // else is true of the sender.
  const partition = (event.sender.session as Session & { storagePath?: string }).storagePath ?? "";
  if (partition.includes("persist_web") || partition.includes("persist:web")) {
    throw new UntrustedSenderError("sender is in a web browsing partition", where);
  }
}

/**
 * Applied to every session that shows remote content. Deny by default: a page gets no
 * camera, microphone, geolocation, notifications, clipboard or anything else unless
 * XENIUR grows a deliberate, person-facing flow for it.
 */
export function lockDownSession(session: Session): void {
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
}
