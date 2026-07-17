import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthedRequest, PrivyAuthGuard } from '../auth/privy-auth.guard';
import { IsEthAddressPipe } from '../common/is-eth-address.pipe';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  /**
   * Auto-provision / touch the caller's profile. Called by the web app right
   * after Privy sign-in so a row always exists for the current user.
   */
  @Post('me')
  @UseGuards(PrivyAuthGuard)
  ensure(@Req() req: AuthedRequest) {
    return this.profiles.ensure(req.user!);
  }

  /** Read the caller's own profile. */
  @Get('me')
  @UseGuards(PrivyAuthGuard)
  async me(@Req() req: AuthedRequest) {
    return this.profiles.ensure(req.user!);
  }

  /** Edit the caller's own profile (display name, avatar). */
  @Patch('me')
  @UseGuards(PrivyAuthGuard)
  update(@Req() req: AuthedRequest, @Body() dto: UpdateProfileDto) {
    return this.profiles.update(req.user!, dto);
  }

  /** Public read of any profile by address — for showing a member's name/avatar. */
  @Get(':address')
  get(@Param('address', IsEthAddressPipe) address: string) {
    return this.profiles.get(address);
  }
}
