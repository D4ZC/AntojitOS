import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class MergeAccountDto {
  @ApiProperty()
  @IsUUID()
  destinationAccountId!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  sourceExpectedVersion!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  destinationExpectedVersion!: number;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  reason!: string;
}
