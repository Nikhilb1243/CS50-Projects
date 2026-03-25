#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>

int main(int argc, char *argv[])
{
    // check for correct usage
    if (argc != 2)
    {
        printf("Usage: ./recover IMAGE\n");
        return 1;
    }

    // open the memory card
    FILE *input = fopen(argv[1], "r");
    if (input == NULL)
    {
        printf("Could not open file.\n");
        return 1;
    }

    // create a buffer for 512 bytes
    uint8_t buffer[512];

    // track number of images found
    int count = 0;

    // pointer for the current jpg file
    FILE *output = NULL;

    // buffer for filename (e.g., "000.jpg")
    char filename[8];

    // read through the memory card 512 bytes at a time
    while (fread(buffer, 1, 512, input) == 512)
    {
        // check if this block is the start of a JPEG
        if (buffer[0] == 0xff && buffer[1] == 0xd8 && buffer[2] == 0xff && (buffer[3] & 0xf0) == 0xe0)
        {
            // if we were already writing a file, close it first
            if (output != NULL)
            {
                fclose(output);
            }

            // create new filename
            sprintf(filename, "%03i.jpg", count);

            // open the new file for writing
            output = fopen(filename, "w");
            count++;
        }

        // if we have an open file, keep writing to it
        if (output != NULL)
        {
            fwrite(buffer, 1, 512, output);
        }
    }

    // close any remaining open files
    if (output != NULL)
    {
        fclose(output);
    }
    fclose(input);

    return 0;
}
