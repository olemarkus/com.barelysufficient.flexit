/** A fan-profile failure that is safe and useful to show in Homey. */
export class FanProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FanProfileError';
  }
}
