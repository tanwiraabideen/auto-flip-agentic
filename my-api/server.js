// We are using a seperate server for API as we don't want to use Expo API as it's newer
import { PrismaClient } from './generated/prisma/index.js';
import { withAccelerate } from '@prisma/extension-accelerate';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();


const prisma = new PrismaClient().$extends(withAccelerate());

app.use(cors());
app.use(express.json());

// Get matched cars for a user

app.get('/cars/user/:userId', async (req, res) => {
    const filters = await prisma.filters.findMany({
        where: { userId: req.params.userId },
        include: {
            FilterListing: {
                include: {
                    Cars: true
                }
            }
        }
    })

    // flatten all cars across all filters, removing duplicates
    const carsMap = new Map()
    filters.forEach(filter => {
        filter.FilterListing.forEach(({ Cars }) => {
            carsMap.set(Cars.id, Cars)
        })
    })

    res.json(Array.from(carsMap.values()))
})


// Get all listings
app.get('/listings', async (req, res) => {
    const listings = await prisma.cars.findMany();
    res.json(listings);
});

// Get a listing
app.get('/listings/:id', async (req, res) => {
    const car = await prisma.cars.findUnique({
        where: { id: parseInt(req.params.id) },
    });
    res.json(car);
});

// Get a filter
app.get('/filters/:id', async (req, res) => {
    const filter = await prisma.filters.findUnique({
        where: { id: parseInt(req.params.id) },
    });
    res.json(filter);
});

// Get all filters
app.get('/filters', async (req, res) => {
    const filters = await prisma.filters.findMany();
    res.json(filters);
});


// Get all filters for a user
app.get('/filters/user/:userId', async (req, res) => {
    const filters = await prisma.filters.findMany({
        where: {
            userId: req.params.userId
        }
    });
    res.json(filters);
});

// Create a listing
app.post('/listings', async (req, res) => {
    const listing = await prisma.cars.create({ data: req.body })
    res.json(listing)
})

// Create a filter
app.post('/filters', async (req, res) => {
    const filter = await prisma.filters.create({
        data: {
            name: req.body.name,
            make: req.body.make,
            model: req.body.model,
            minYear: req.body.minYear,
            maxYear: req.body.maxYear,
            minPrice: req.body.minPrice,
            maxPrice: req.body.maxPrice,
            minMileage: req.body.minMileage,
            maxMileage: req.body.maxMileage,
            user: {
                connect: { id: req.body.userId }
            }
        }
    })
    res.json(filter)
})

// Delete a filter

app.delete('/filters/delete/:id', async (req, res) => {
    const filter = await prisma.filters.delete({
        where: {
            id: parseInt(req.params.id)
        }
    })
    res.json(filter)
})

// Create a filter-car match
app.post('/filterListing', async (req, res) => {
    const filterListing = await prisma.filterListing.create({ data: req.body })
    res.json(filterListing)
})

// Create a user
app.post('/user', async (req, res) => {
    try {
        const user = await prisma.user.create({ data: req.body })
        res.json(user)
    } catch (error) {
        throw new Error(`Error when creating user in prisma: ${error}`)
    }

})

// Get a user
app.get('/user/:clerkId', async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { clerkId: req.params.clerkId }
    })
    res.json(user)
})



app.listen(3000, () => console.log('Server running on port 3000'));
