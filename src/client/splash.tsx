import './index.css';

import { context, requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#72b65d] font-mono text-slate-900">
      <div className="absolute inset-x-0 top-1/2 h-10 -translate-y-1/2 bg-[#6f6b5f]" />
      <div className="absolute left-[14%] top-[26%] h-16 w-16 border-4 border-slate-900 bg-[#e4572e] shadow-[6px_6px_0_#111827]" />
      <div className="absolute right-[18%] top-[20%] h-20 w-20 border-4 border-slate-900 bg-[#17bebb] shadow-[6px_6px_0_#111827]" />
      <div className="absolute bottom-[20%] left-[28%] h-14 w-14 border-4 border-slate-900 bg-[#ffc914] shadow-[6px_6px_0_#111827]" />
      <div className="relative flex w-full max-w-md flex-col items-center gap-4 px-6 text-center">
        <h1 className="text-3xl font-bold">Scroll Town</h1>
        <p className="text-sm">
          Hey {context.username ?? 'traveler'}, walk through Reddit as pixel towns
          and post buildings.
        </p>
        <button
          className="h-12 border-2 border-slate-900 bg-[#fff7cc] px-5 text-sm shadow-[4px_4px_0_#111827]"
          onClick={(event) => requestExpandedMode(event.nativeEvent, 'game')}
        >
          Start
        </button>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
