import { Suspense } from "react";
import { CollectionView } from "@/components/library/collection-view";

function decode(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// The name is only known at request time, so it's read inside Suspense.
export default function Page({ params }: PageProps<"/genres/[name]">) {
  return (
    <Suspense fallback={null}>
      {params.then(({ name }) => (
        <CollectionView section="genres" name={decode(name)} />
      ))}
    </Suspense>
  );
}
