"use client";
import React, { Suspense } from "react";
import type { AdvancedViewProps } from "./AdvancedView";

const LazyAdvancedView = React.lazy(() => import("./AdvancedView"));

export default function AdvancedViewLazy(props: AdvancedViewProps) {
  return (
    <Suspense fallback={null}>
      <LazyAdvancedView {...props} />
    </Suspense>
  );
}
