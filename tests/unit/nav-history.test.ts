import { beforeEach, describe, expect, it } from "vitest";
import {
  previousScreen,
  recordScreen,
  replaceCurrentScreen,
  resetScreens,
  startNewTrail,
} from "@/lib/nav-history";

beforeEach(() => resetScreens());

const back = () => previousScreen()?.url ?? null;

describe("back goes where the person came from", () => {
  it("has nothing before the first screen, so the page's own backHref is used", () => {
    recordScreen("/customers/c1");
    expect(previousScreen()).toBeNull();
  });

  it("returns a profile to whichever screen opened it", () => {
    recordScreen("/today");
    recordScreen("/customers/c1");
    expect(back()).toBe("/today");

    resetScreens();
    recordScreen("/follow-ups?tab=all");
    recordScreen("/customers/c1");
    expect(back()).toBe("/follow-ups?tab=all");
  });

  it("keeps the search that was on screen", () => {
    recordScreen("/customers");
    recordScreen("/customers?mobile=9800000001");
    recordScreen("/customers/c1");
    expect(back()).toBe("/customers?mobile=9800000001");
  });

  it("walks back one screen at a time", () => {
    recordScreen("/follow-ups");
    recordScreen("/customers/c1");
    recordScreen("/follow-ups/f1");
    expect(back()).toBe("/customers/c1");

    recordScreen("/customers/c1", true); // the arrow (or the browser) went back
    expect(previousScreen()).toEqual({ url: "/follow-ups", viaHistory: true });
  });

  it("counts a form that returns to its opener as going back, not as a new screen", () => {
    recordScreen("/today");
    recordScreen("/customers/c1");
    recordScreen("/customers/c1/edit");
    recordScreen("/customers/c1"); // saved → back on the profile
    expect(back()).toBe("/today");
  });

  it("skips a finished form that handed over to the next screen", () => {
    recordScreen("/customers?mobile=9800000009");
    recordScreen("/customers/new?mobile=9800000009");
    replaceCurrentScreen();
    recordScreen("/visits/new?customerId=c9");
    expect(back()).toBe("/customers?mobile=9800000009");
  });

  it("never offers the login screen as back, and forgets the previous person's screens", () => {
    recordScreen("/overview");
    recordScreen("/customers/c1");
    recordScreen("/login?next=%2Fcustomers%2Fc2");
    recordScreen("/customers/c2"); // landed from ?next=
    expect(previousScreen()).toBeNull();
    recordScreen("/customers/c2/edit");
    expect(back()).toBe("/customers/c2");
  });

  it("starts over after a step that leaves nothing to go back to", () => {
    recordScreen("/customers/c1");
    recordScreen("/customers/c1/delete-data");
    startNewTrail();
    recordScreen("/customers");
    expect(previousScreen()).toBeNull();
  });
});

describe("going back through history when it matches", () => {
  it("uses history after a plain forward step", () => {
    recordScreen("/today");
    recordScreen("/customers/c1");
    expect(previousScreen()).toEqual({ url: "/today", viaHistory: true });
  });

  it("pushes the address once filters changed what the browser holds", () => {
    recordScreen("/overview");
    recordScreen("/overview?period=yesterday"); // may be a pushed entry of its own
    recordScreen("/reports/r1");
    recordScreen("/reports/r1?page=2");
    expect(previousScreen()).toEqual({ url: "/overview?period=yesterday", viaHistory: false });
  });

  it("goes by address after a form returned to its opener, whose entry is still behind", () => {
    recordScreen("/today");
    recordScreen("/customers/c1");
    recordScreen("/customers/c1/edit");
    recordScreen("/customers/c1"); // Save pushed the profile again
    expect(previousScreen()).toEqual({ url: "/today", viaHistory: false });
  });

  it("goes by address after the browser jumped somewhere off the trail", () => {
    recordScreen("/today");
    recordScreen("/customers/c1");
    recordScreen("/follow-ups", true); // e.g. Back twice in one go
    expect(previousScreen()?.viaHistory).toBe(false);
  });

  it("still uses history across a form that replaced itself", () => {
    recordScreen("/customers?mobile=9800000009");
    recordScreen("/customers/new?mobile=9800000009");
    replaceCurrentScreen();
    recordScreen("/visits/new?customerId=c9");
    expect(previousScreen()?.viaHistory).toBe(true);
  });
});
