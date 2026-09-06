import { useEffect, useState } from 'react';
import { exactExerciseUrl } from '../core/share.js';

// Send someone the exact music you just read.
//
// A shared link carries the whole recipe, not just the seed, so the person who
// opens it reads the identical bars — cold, the way you did. That makes the
// share a challenge rather than a bookmark. Nothing is sent anywhere by the
// app: the link goes to the clipboard and the sending is the reader's own.

export default function ShareChallenge({ score, label = 'Challenge a friend' }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const href = typeof window === 'undefined' ? '' : window.location.href;
    const url = exactExerciseUrl(score, href);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused. The address bar already holds the
      // exact link, so say that rather than failing silently.
      setCopied('manual');
    }
  };

  return (
    <button type="button" className="sr-btn sr-challenge" onClick={copy}>
      {copied === 'manual'
        ? 'Copy the address bar — it is the exact link'
        : copied ? 'Link copied — they read the same bars, cold' : label}
    </button>
  );
}
