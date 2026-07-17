import { ArrayMaxSize, IsArray, IsEmail, IsEthereumAddress, IsOptional } from 'class-validator';

export class CreateInvitesDto {
  /** The circle to invite to. Must be a circle the caller created. */
  @IsEthereumAddress()
  circleAddress!: string;

  /** Optional list of emails to invite. Empty/omitted → only the LINK is minted. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  emails?: string[];
}
