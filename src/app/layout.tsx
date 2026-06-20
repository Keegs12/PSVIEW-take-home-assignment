import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PSVIEW — Autonomous Recruiting Agent',
  description: 'An agent that configures itself from a company context, plans a grounded outreach sequence, and reasons over candidate replies.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
