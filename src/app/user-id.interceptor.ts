import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap } from 'rxjs';
import { AuthService } from './auth.service';

/** Adds the Authorization Bearer token to outgoing API requests. */
export const userIdInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  // Only add auth header to our API calls, not external APIs (e.g. dictionary)
  if (!req.url.includes('/studies') && !req.url.includes('/ai/')) {
    return next(req);
  }

  return from(auth.getIdToken()).pipe(
    switchMap((token) => {
      if (token) {
        const cloned = req.clone({
          setHeaders: { Authorization: token },
        });
        return next(cloned);
      }
      return next(req);
    }),
  );
};
