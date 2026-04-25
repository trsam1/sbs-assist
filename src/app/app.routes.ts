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
];
