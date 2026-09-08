"use client";

/**
 * The scene loads after first paint as its own chunk, so the server-rendered page is the floor
 * until it arrives (and stays the page for phones, no script and reduced motion).
 */
import dynamic from "next/dynamic";
import type { SceneData } from "./drawing-data";

const Scene = dynamic(() => import("./scene").then((m) => m.Scene), { ssr: false });

export function SceneLoader({ data }: { data: SceneData }) {
  return <Scene data={data} />;
}
