import type { Metadata } from "next";
import { AlbumsView } from "@/components/library/views";

export const metadata: Metadata = { title: "Albums · SingAlongSync" };

export default function Page() {
  return <AlbumsView />;
}
