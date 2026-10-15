import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsString, MaxLength } from "class-validator";

export class RefundReceiptDto {
  @ApiProperty({ enum: ["cancellation", "refund"] })
  @IsIn(["cancellation", "refund"])
  kind!: "cancellation" | "refund";

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;
}
