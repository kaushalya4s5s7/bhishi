import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Rejects anything that isn't a 0x-prefixed 20-byte address before it reaches
 *  a query (api-use-pipes / security-validate-all-input). */
@Injectable()
export class IsEthAddressPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^0x[a-fA-F0-9]{40}$/.test(value ?? '')) {
      throw new BadRequestException('Invalid address');
    }
    return value.toLowerCase();
  }
}
