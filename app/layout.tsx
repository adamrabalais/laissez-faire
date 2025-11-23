import 'app/globals.css';
import { Metadata } from 'next';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Laissez-faire Meal Planner',
  description: 'A simple meal planner for Skylar.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased bg-stone-50 text-stone-900`}>
        {children}
      </body>
    </html>
  );
}
