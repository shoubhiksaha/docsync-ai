'use client';
import { useEffect, useMemo } from 'react';

/** Object URLs for page images, revoked when the pages change or the component unmounts. */
export function usePageUrls(pages: Blob[]): string[] {
  const urls = useMemo(() => pages.map(page => URL.createObjectURL(page)), [pages]);
  useEffect(() => () => urls.forEach(url => URL.revokeObjectURL(url)), [urls]);
  return urls;
}
