import type { Metadata } from "next";
import { GenresView } from "@/components/library/views";

export const metadata: Metadata = { title: "Genres · SingAlongSync" };

export default function Page() {
  return <GenresView />;
}
