'use client'; // error boundaries are client components
// A page that crashed: the nav stays, and instead of a blank screen or a stack trace you get what happened
// and two ways on. The full error is in the console (and the terminal running Munto).
import Link from 'next/link';
import { useEffect } from 'react';
import { Jar } from '@/components/ui.jsx';

export default function PageError({ error, retry }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="empty page-error" role="alert">
      <Jar fill={0} className="jar-empty" />
      <strong>This page didn’t load</strong>
      Something went wrong in Munto while it was getting this page ready. Your data is as it was.
      <div className="link-row">
        <button className="btn btn-ink" type="button" onClick={() => retry()}>Try again</button>
        <Link className="btn" href="/">Go to Overview</Link>
      </div>
    </div>
  );
}
