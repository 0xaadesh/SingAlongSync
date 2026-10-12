import type { Metadata } from "next";
import { ArtistsView } from "@/components/library/views";

export const metadata: Metadata = { title: "Artists · SingAlongSync" };

export default function Page() {
  return <ArtistsView />;
}
