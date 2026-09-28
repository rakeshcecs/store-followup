// The screens this tab has walked through, so a screen's back arrow can return to where
// the person actually came from — the prototype's back() — instead of one fixed page. A
// customer profile is reached from Today, a search, the follow-up list, a sale…; a fixed
// "/customers" threw all of that away. The screen's own backHref stays the fallback for
// a link opened cold (a notification, a bookmark, a reload), where there is no "before".
//
// Kept in memory, not sessionStorage: a reload starts clean, which is exactly the case
// the fallback is for.

const MAX_SCREENS = 50;
// Never anyone's "back", and nothing before them is either: a sign-in starts a new trail.
const TRAIL_STARTS = ["/login", "/set-pin"];

type Screen = {
  url: string;
  // Reached by a plain forward step from the screen before it, so that screen is also
  // the browser's previous entry and the arrow can simply go back in history.
  followsPrevious: boolean;
};

let trail: Screen[] = [];
let replaceNext = false;

function pathOf(url: string): string {
  return url.split("?")[0] ?? url;
}

// viaHistory: the browser moved through its history to get here (its Back, or the arrow
// going back) rather than a link or a form opening the address.
export function recordScreen(url: string, viaHistory = false): void {
  if (TRAIL_STARTS.includes(pathOf(url))) {
    trail = [];
    replaceNext = false;
    return;
  }
  const top = trail.at(-1);
  if (top?.url === url) return;

  // Arriving at the screen before this one is going back, by the arrow, the browser or
  // a form that returns where it was opened from (Edit customer → profile).
  if (trail.at(-2)?.url === url) {
    trail.pop();
    replaceNext = false;
    // A form that opened the address again (not the browser going back) left its own
    // entry in history behind this one: going back in history would reopen the form.
    const current = trail.at(-1);
    if (current && !viaHistory) current.followsPrevious = false;
    return;
  }

  // A form that handed over (replaceCurrentScreen): the browser replaced its entry too,
  // so what came before is still the entry before.
  if (top && replaceNext) {
    trail[trail.length - 1] = { url, followsPrevious: top.followsPrevious };
    replaceNext = false;
    return;
  }

  // The same screen with other filters (a tab, a period, a search) is still that screen:
  // back from what comes next lands on it as it was last seen, once. The browser may
  // have stacked each filter as an entry, so history is no longer a safe way back.
  if (top && pathOf(top.url) === pathOf(url)) {
    trail[trail.length - 1] = { url, followsPrevious: false };
    return;
  }

  // Reached through history but not one step back along the trail: where the browser's
  // entries now stand is unknown, so the arrow goes by address from here.
  trail.push({ url, followsPrevious: top !== undefined && !viaHistory });
  if (trail.length > MAX_SCREENS) trail.shift();
}

export type BackTarget = { url: string; viaHistory: boolean };

// Where the back arrow should go, or null when this screen was the first one opened.
// viaHistory: go back in the browser's history rather than forward to the url, so the
// browser's (or the phone's) own Back afterwards does not reopen the screen just left.
export function previousScreen(): BackTarget | null {
  const current = trail.at(-1);
  const before = trail.at(-2);
  if (!current || !before) return null;
  return { url: before.url, viaHistory: current.followsPrevious };
}

// For a form that has done its job and moves on with router.replace: the next screen
// takes the form's place, so back from it skips the finished form (New customer →
// Record visit → back goes to the search, not to an empty form for a customer who now
// exists).
export function replaceCurrentScreen(): void {
  replaceNext = true;
}

// For a step after which nothing behind it makes sense any more (a customer's data was
// just deleted): the next screen is the first of a new trail, and its arrow uses the
// page's own backHref.
export function startNewTrail(): void {
  trail = [];
  replaceNext = false;
}

// Tests only.
export function resetScreens(): void {
  startNewTrail();
}
