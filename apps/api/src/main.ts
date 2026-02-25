import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { HttpErrorFilter } from "./common/http-error.filter";
import { getResolvedAppConfig, loadApiEnvFile } from "./config/env";

async function bootstrap(): Promise<void> {
  loadApiEnvFile();
  const cfg = getResolvedAppConfig();
  const app = await NestFactory.create(AppModule, {
    cors: true,
  });
  app.useGlobalFilters(new HttpErrorFilter());
  const port = cfg.port;
  const host = cfg.host;
  await app.listen(port, host);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
