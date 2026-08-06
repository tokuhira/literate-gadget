@*Sieve of Eratosthenes.
This program prints every prime below |LIMIT|.
The overall shape of the program is stated first;
the details are deferred to later sections.

@d LIMIT 50

@c
@<Header files@>@;
@<Global variables@>@;
int main(void) {
  @<Cross out the composites@>@;
  @<Print the survivors@>@;
  return 0;
}

@ We need only standard input/output.
@<Header files@>=
#include <stdio.h>

@ The sieve is a byte array; |composite[n]| becomes nonzero
once we discover a factor of |n|.
@<Global variables@>=
char composite[LIMIT];

@ We need only cross out multiples of |p| starting at $p^2$,
since smaller multiples have a smaller factor and are already gone.
@<Cross out the composites@>=
for (int p = 2; p * p < LIMIT; p++)
  if (!composite[p])
    for (int q = p * p; q < LIMIT; q += p) composite[q] = 1;

@ What survives is prime.
@<Print the survivors@>=
for (int n = 2; n < LIMIT; n++)
  if (!composite[n]) printf("%d ", n);
putchar('\n');
