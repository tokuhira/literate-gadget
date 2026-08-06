#!/usr/bin/env perl
use strict; use warnings;
my $limit = 50;
my @composite;
for (my $p = 2; $p * $p <= $limit; $p++) {
    next if $composite[$p];
    for (my $q = $p * $p; $q <= $limit; $q += $p) {
        $composite[$q] = 1;
    }
}
print join(' ', grep { !$composite[$_] } 2 .. $limit), "\n";
