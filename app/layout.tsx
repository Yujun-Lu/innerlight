import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Innerlight · Return to yourself", description: "Give love. Include yourself. A moment to speak, feel seen, and carry a little care back into your day.", icons: { icon: "/favicon.svg" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
