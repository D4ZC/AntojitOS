import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, Min } from "class-validator";

export class TransitionTicketDto {
  @ApiProperty({ enum: ["in_progress", "ready", "delivered"] })
  @IsIn(["in_progress", "ready", "delivered"])
  status!: "in_progress" | "ready" | "delivered";

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion!: number;
}
