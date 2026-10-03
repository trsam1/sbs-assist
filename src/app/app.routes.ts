import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./study-list/study-list.component').then((m) => m.StudyListComponent),
  },
  {
    path: 'study/new',
    loadComponent: () =>
      import('./study-page/study-page.component').then((m) => m.StudyPageComponent),
  },
  {
    path: 'study/:studyId',
    loadComponent: () =>
      import('./study-page/study-page.component').then((m) => m.StudyPageComponent),
  },
  {
    path: 'scrolls',
    loadComponent: () =>
      import('./scroll-list/scroll-list.component').then((m) => m.ScrollListComponent),
  },
  {
    path: 'scroll/new',
    loadComponent: () =>
      import('./scroll-upload/scroll-upload.component').then((m) => m.ScrollUploadComponent),
  },
  {
    path: 'scroll/:scrollStudyId',
    loadComponent: () =>
      import('./scroll-view/scroll-view.component').then((m) => m.ScrollViewComponent),
  },
];
