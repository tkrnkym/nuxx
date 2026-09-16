import {
  WAITLIST_RECIPIENT,
  type WaitlistAnswers,
  waitlistMailPayload,
} from "@/features/waitlist/waitlist-model";

/**
 * Delivery for the waitlist form.
 *
 * The submission is mailed to {@link WAITLIST_RECIPIENT} by a hosted form-relay
 * service, not by us. Nuxx has no mail path of its own — no SMTP credentials,
 * no sending domain, no bounce handling — and a waitlist that receives a
 * handful of submissions a week is not the reason to acquire all three. A
 * `mailto:` link was the other candidate and loses submissions outright on any
 * device without a configured mail client, silently, with no way to tell.
 *
 * The request is a plain JSON POST, which is the shape Web3Forms and Formspree
 * both accept, so the endpoint can be repointed without touching this file.
 */

/** Web3Forms' endpoint, which needs {@link accessKey}. Override for Formspree. */
const DEFAULT_ENDPOINT = "https://api.web3forms.com/submit";

function endpoint(): string {
  return import.meta.env.VITE_WAITLIST_ENDPOINT || DEFAULT_ENDPOINT;
}

/** Web3Forms routes on this key; Formspree encodes the target in the URL. */
function accessKey(): string | undefined {
  return import.meta.env.VITE_WAITLIST_ACCESS_KEY || undefined;
}

/**
 * Whether the form is wired up at all.
 *
 * Surfaced on the dialog's opening screen so a build with no endpoint says so
 * up front, rather than taking someone through six questions and failing on the
 * submit — the one point in the flow where the answers are already typed. The
 * flow stays walkable either way, so an unconfigured preview build can still be
 * reviewed end to end.
 */
export function isWaitlistConfigured(): boolean {
  return Boolean(accessKey() || import.meta.env.VITE_WAITLIST_ENDPOINT);
}

/** A submission that failed, with a message meant for the person who sent it. */
export class WaitlistSubmitError extends Error {}

/**
 * Mail one completed form to {@link WAITLIST_RECIPIENT}.
 *
 * Resolves only once the relay service has accepted the submission, so the
 * caller can navigate to the thank-you screen knowing the mail is on its way.
 * Rejects with a {@link WaitlistSubmitError} otherwise.
 */
export async function submitWaitlist(answers: WaitlistAnswers): Promise<void> {
  if (!isWaitlistConfigured()) {
    throw new WaitlistSubmitError(
      "フォームの送信先が設定されていません。管理者にお問い合わせください。",
    );
  }

  const key = accessKey();
  const body = {
    ...(key ? { access_key: key } : {}),
    ...waitlistMailPayload(answers),
  };

  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    // A rejected `fetch` here is the network, an ad blocker, or the service
    // being down — never a bad payload, which comes back as a 4xx.
    throw new WaitlistSubmitError(
      "送信できませんでした。通信環境をご確認のうえ、もう一度お試しください。",
    );
  }

  // Both services answer 200 with `{"success": false}` for a rejected
  // submission, so the status alone does not settle it.
  const result = (await response.json().catch(() => null)) as {
    success?: boolean;
    message?: string;
  } | null;

  if (!response.ok || result?.success === false) {
    throw new WaitlistSubmitError(
      result?.message ||
        `送信できませんでした。お手数ですが ${WAITLIST_RECIPIENT} まで直接ご連絡ください。`,
    );
  }
}
