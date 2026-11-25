import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { currentView, isTauriRuntime } from './native/desktop';
import { Workspace } from './workspace/Workspace';
import { PetApp } from './pet/PetApp';
import './styles.css';

// Dev-only contact sheet of every pet state; never part of the desktop windows.
const PetGallery = lazy(() => import('./pet/PetGallery').then((module) => ({ default: module.PetGallery })));
// Sticky windows load only this small view: no workspace, no pet, no three.js.
const StickyApp = lazy(() => import('./sticky/StickyApp').then((module) => ({ default: module.StickyApp })));
const showGallery =
  import.meta.env.DEV && !isTauriRuntime() && new URLSearchParams(window.location.search).get('view') === 'pet-gallery';

// Both windows load this bundle; the window label decides which surface renders.
const view = currentView();
document.documentElement.dataset.view = showGallery ? 'gallery' : view;

// Native-feeling surfaces: no browser context menu except inside text fields.
window.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement;
  if (!target.closest('textarea, input')) event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showGallery ? (
      <Suspense fallback={null}>
        <PetGallery />
      </Suspense>
    ) : view === 'sticky' ? (
      <Suspense fallback={null}>
        <StickyApp />
      </Suspense>
    ) : view === 'pet' ? (
      <PetApp />
    ) : (
      <Workspace />
    )}
  </StrictMode>
);
