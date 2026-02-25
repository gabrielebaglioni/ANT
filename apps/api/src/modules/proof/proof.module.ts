import { Global, Module } from "@nestjs/common";
import { ProofService } from "./proof.service";

@Global()
@Module({
  providers: [ProofService],
  exports: [ProofService],
})
export class ProofModule {}
