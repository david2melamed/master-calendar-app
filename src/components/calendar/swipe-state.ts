/**
 * Shared between the swipe pager and the time grids: while a swipe is in
 * progress, every time grid opens at the same scroll position (time of day)
 * instead of jumping to "now" / 7 AM, so the pages line up as they slide.
 */
export const swipeScroll = { active: false, top: 0 };
