import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ComponentsDemo } from "./components-demo";

// Developer-only gallery of shared components (M01). Hidden in production; English on purpose.
export const metadata: Metadata = { title: "Components", robots: { index: false } };

export default function DevComponentsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ComponentsDemo />;
}
