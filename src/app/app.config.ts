import { ApplicationConfig, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { userIdInterceptor } from './user-id.interceptor';
import { loadRuntimeConfig, showFatalConfigError } from './runtime-config';
import { configureAmplify } from './auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Runs before the root component (and AuthService) is created.
    provideAppInitializer(async () => {
      try {
        const cfg = await loadRuntimeConfig();
        configureAmplify(cfg);
      } catch (err) {
        console.error('Startup configuration failed:', err);
        showFatalConfigError();
        throw err;
      }
    }),
    provideHttpClient(withInterceptors([userIdInterceptor])),
    provideRouter(routes),
  ],
};
