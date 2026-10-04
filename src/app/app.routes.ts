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
  {
    path: 'scroll/:scrollStudyId/pronouns',
    loadComponent: () =>
      import('./pronoun-view/pronoun-view.component').then((m) => m.PronounViewComponent),
  },
  {
    path: 'scroll/:scrollStudyId/antecedents',
    loadComponent: () =>
      import('./antecedent-view/antecedent-view.component').then((m) => m.AntecedentViewComponent),
  },
  {
    path: 'books',
    loadComponent: () =>
      import('./book-study-list/book-study-list.component').then((m) => m.BookStudyListComponent),
  },
  {
    path: 'books/new',
    loadComponent: () =>
      import('./book-study-form/book-study-form.component').then((m) => m.BookStudyFormComponent),
  },
  {
    path: 'books/:bookStudyId',
    loadComponent: () =>
      import('./book-study-detail/book-study-detail.component').then(
        (m) => m.BookStudyDetailComponent,
      ),
  },
];
