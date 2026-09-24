import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import { PushPrompt } from "@/components/pwa/push-prompt";

const platform = vi.hoisted(() => ({ value: "other" as "ios" | "other" | "standalone" }));
vi.mock("@/components/pwa/install-help", () => ({ detectPlatform: () => platform.value }));
const subscribePush = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, data: { saved: true } })),
);
vi.mock("@/lib/actions/notifications", () => ({ subscribePush }));

const p = en.notifications.permission;

type Setup = { push: boolean; permission?: NotificationPermission; registered?: boolean };

// jsdom has no service worker, push or Notification; each test says what the phone has.
function phone({ push, permission = "default", registered = true }: Setup) {
  const subscription = {
    toJSON: () => ({ endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } }),
  };
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => subscription),
    },
  };
  if (push) {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      // `ready` settles only once a worker is active; with none it never does.
      value: { ready: registered ? Promise.resolve(registration) : new Promise(() => {}) },
    });
    Object.defineProperty(window, "PushManager", { configurable: true, value: function () {} });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission, requestPermission: vi.fn(async () => "granted") },
    });
  }
  return registration;
}

async function show(publicKey = "AQID", worker = true) {
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata">
        <PushPrompt publicKey={publicKey} worker={worker} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  platform.value = "other";
  subscribePush.mockClear();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  for (const [target, key] of [
    [navigator, "serviceWorker"],
    [window, "PushManager"],
    [window, "Notification"],
  ] as const) {
    Reflect.deleteProperty(target, key);
  }
});

describe("PushPrompt (M14.01)", () => {
  it("explains first, then asks; Not now hides it for 3 days", async () => {
    phone({ push: true });
    await show();
    expect(screen.getByText(p.text)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: p.notNow }));
    expect(screen.queryByText(p.text)).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("push-prompt")!)).toMatchObject({ asks: 1 });
  });

  it("does not ask again while snoozed", async () => {
    localStorage.setItem("push-prompt", JSON.stringify({ asks: 1, nextAt: Date.now() + 60_000 }));
    phone({ push: true });
    await show();
    expect(screen.queryByText(p.text)).not.toBeInTheDocument();
  });

  it("Allow asks the browser and saves this device", async () => {
    const registration = phone({ push: true });
    await show();
    await userEvent.click(screen.getByRole("button", { name: p.allow }));
    expect(registration.pushManager.subscribe).toHaveBeenCalled();
    expect(subscribePush).toHaveBeenCalledWith({
      endpoint: "https://push.example/1",
      keys: { p256dh: "p", auth: "a" },
    });
  });

  it("stays quiet once allowed, just keeping the device saved", async () => {
    phone({ push: true, permission: "granted" });
    await show();
    expect(screen.queryByText(p.text)).not.toBeInTheDocument();
    expect(subscribePush).toHaveBeenCalledTimes(1);
  });

  it("shows the install steps on an iPhone that has not added the app (M14.07)", async () => {
    platform.value = "ios";
    phone({ push: false });
    await show();
    expect(screen.getByText(p.ios)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: p.allow })).not.toBeInTheDocument();
  });

  it("shows nothing without keys, or where no service worker runs (development)", async () => {
    phone({ push: true });
    await show("");
    expect(screen.queryByText(p.text)).not.toBeInTheDocument();

    await show("AQID", false);
    expect(screen.queryByText(p.text)).not.toBeInTheDocument();
  });

  it("waits for the service worker to be active before asking", async () => {
    phone({ push: true, registered: false }); // still installing: `ready` has not settled
    await show();
    expect(screen.queryByText(p.text)).not.toBeInTheDocument();
  });
});
