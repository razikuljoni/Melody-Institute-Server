const express = require('express')
const cors = require("cors")
const dotenv = require("dotenv").config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 8000

const app = express();

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Payment options
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY)

const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function main() {
    try {
        await client.connect()
        console.log("Database Connection Established!")

        app.listen(port, () => {
            console.log(`Melody Institute app listening on port ${port}`)
        })

        app.get('/', (req, res) => {
            res.send('🆗 Melody Institute Server in running!')
        })

        const userCollection = client.db("melody-institute").collection("users")
        const classCollection = client.db("melody-institute").collection("classes")
        const cartCollection = client.db("melody-institute").collection("student_cart")

        // INFO: Users
        app.get('/api/v1/users', async (req, res) => {
            const result = await userCollection.find({}).toArray()
            res.send(result)
        });

        app.get('/api/v1/users/:email', async (req, res) => {
            const email = req.params.email;
            const result = await userCollection.findOne({ email: email })
            res.send(result)
        });

        app.post('/api/v1/users', async (req, res) => {
            const user = req.body;
            const result = await userCollection.insertOne(user)
            res.send(result)
        });

        app.patch("/api/v1/users/:email", async (req, res) => {
            const { email } = req.params;
            const { phone, address, gender } = req.body;
            if (req.query.addNewClass) {
                const newClass = await userCollection.findOne({ email: email });
                const updatedClass = newClass.total_classes + 1
                const result = await userCollection.findOneAndUpdate({ email: email }, { $set: { total_classes: updatedClass } });
                res.send(result);
            } else {
                const result = await userCollection.findOneAndUpdate({ email: email }, { $set: { phone: phone, address: address, gender: gender } });
                res.send(result);
            }
        });

        app.patch("/api/v1/users", async (req, res) => {
            const { id } = req.query;
            const { role } = req.body;
            const result = await userCollection.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: { role: role } });
            res.send(result);
        })

        // INFO: Classes services
        app.get("/api/v1/classes", async (req, res) => {
            const { classId } = req.query;
            if (classId) {
                const result = await classCollection.find({ _id: new ObjectId(classId) }).toArray();
                res.send(result);
            } else {
                const result = await classCollection.find({}).toArray();
                res.send(result);
            }
        });

        app.get("/api/v1/classes/:email", async (req, res) => {
            const { email } = req.params;
            const result = await classCollection.find({ instructor_email: email }).toArray();
            res.send(result);
        });

        app.post("/api/v1/classes", async (req, res) => {
            const cls = req.body;
            const result = await classCollection.insertOne(cls);
            res.send(result);
        });

        app.patch("/api/v1/classes/:id", async (req, res) => {
            const id = req.params.id;
            const { status, rejectionFeedback } = req.body;
            if (status === "approved") {
                await classCollection.findOneAndUpdate({ _id: new ObjectId(id) }, { $unset: { feedback: "" } });
                const result = await classCollection.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: { status: status } });
                res.send(result);
            } else if (status === "rejected") {
                const result = await classCollection.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: { status: status, feedback: rejectionFeedback } });
                res.send(result);
            }
        });

        // INFO: cart services
        app.get("/api/v1/cart/:email", async (req, res) => {
            const email = req.params.email;
            const result = await cartCollection.find({ student_email: email }).toArray();
            res.send(result)
        });

        app.post("/api/v1/cart", async (req, res) => {
            const cls = req.body;
            const result = await cartCollection.insertOne(cls);
            res.send(result)
        });

        app.patch("/api/v1/cart/:email", async (req, res) => {
            const email = req.params.email;
            const data = req.body;
            const { class_type, id } = req.query;
            if (class_type === "selected") {
                const result = await cartCollection.findOneAndUpdate({ student_email: email }, { $set: { selected_classes: data.classes } });
                res.send(result);
            } else if (class_type === "enrolled") {
                // INFO: delete from selected classes array
                await cartCollection.findOneAndUpdate({ student_email: email }, { $pull: { selected_classes: { _id: id } } });
                // INFO: update class information
                const findCls = await classCollection.find({ _id: new ObjectId(id) }).toArray();
                newAvailableSeats = findCls[0]?.available_seats - 1;
                newEnrolledStudents = findCls[0]?.enrolled_students + 1;
                await classCollection.findOneAndUpdate({ _id: new ObjectId(id) }, { $set: { available_seats: newAvailableSeats, enrolled_students: newEnrolledStudents } });
                // INFO: update class information
                const newClass = await userCollection.findOne({ email: email });
                const updatedClass = newClass.enrolled_courses + 1
                await userCollection.findOneAndUpdate({ email: email }, { $set: { enrolled_courses: updatedClass } });
                // INFO: update instructors total students
                const insEmail = data.classes[data.classes.length - 1].instructor_email;
                const instructor = await userCollection.findOne({ email: insEmail });
                const updatedTotalStudents = instructor.total_students + 1;
                await userCollection.findOneAndUpdate({ email: insEmail }, { $set: { total_students: updatedTotalStudents } });
                // INFO: added new class to enrolled classes array
                const result = await cartCollection.findOneAndUpdate({ student_email: email }, { $set: { enrolled_classes: data.classes } });
                res.send(result);
            }
        })

        app.delete("/api/v1/cart/", async (req, res) => {
            const email = req.query.email;
            const id = req.query.id;
            const result = await cartCollection.findOneAndUpdate({ student_email: email }, { $pull: { selected_classes: { _id: id } } });
            res.send(result);
        })

        app.post("/api/v1/create-payment-intent", async (req, res) => {
            const { price } = req.body;
            const ammount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                amount: ammount,
                currency: "usd",
                payment_method_types: ["card"],
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

    } catch (err) {
        console.log(err.message)
    }
}

main()
