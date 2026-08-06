#define LIMIT 50 \

/*1:*/
#line 8 "sieve.w"

/*2:*/
#line 18 "sieve.w"

#include <stdio.h> 

/*:2*/
#line 9 "sieve.w"

/*3:*/
#line 23 "sieve.w"

char composite[LIMIT];

/*:3*/
#line 10 "sieve.w"

int main(void){
/*4:*/
#line 28 "sieve.w"

for(int p= 2;p*p<LIMIT;p++)
if(!composite[p])
for(int q= p*p;q<LIMIT;q+= p)composite[q]= 1;

/*:4*/
#line 12 "sieve.w"

/*5:*/
#line 34 "sieve.w"

for(int n= 2;n<LIMIT;n++)
if(!composite[n])printf("%d ",n);
putchar('\n');/*:5*/
#line 13 "sieve.w"

return 0;
}

/*:1*/
