import { bootstrapApplication } from '@angular/platform-browser';
import { APP_INITIALIZER } from '@angular/core';

import { appConfig } from './app/app.config';
import { App } from './app/app';

import { UiPrefsService } from './app/shared/services/ui-prefs.service';

bootstrapApplication(App, {
  ...appConfig,
  providers: [
    ...(appConfig.providers ?? []),

    // ✅ Aplica preferencias guardadas ANTES de que renderice todo
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [UiPrefsService],
      useFactory: (prefs: UiPrefsService) => () => prefs.init(),
    },
  ],
}).catch((err) => console.error(err));
