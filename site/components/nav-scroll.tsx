"use client";

import { useEffect } from "react";

/**
 * The nav sits on the page ground and grows a hairline under it only once the page has
 * moved. One attribute on the root element, set after mount, so nothing can mismatch.
 */
export function NavScroll() {
  useEffect(() => {
    const root = document.documentElement;
    const mark = () => root.toggleAttribute("data-ac-scrolled", window.scrollY > 4);
    mark();
    window.addEventListener("scroll", mark, { passive: true });
    return () => {
      window.removeEventListener("scroll", mark);
      root.removeAttribute("data-ac-scrolled");
    };
  }, []);
  return null;
}
