const express = require("express");
const axios = require("axios");
const { selectBest } = require("./pso");

const app = express();
app.use(express.json());
app.get("/", (req, res) => {
  res.send("Fraud Detection Load Balancer Running");
});
const instances = [
    "http://api1:3000",
    "http://api2:3000",
    "http://api3:3000"
];


async function getHealthScores() {
    const scores = [];
    for (const url of instances) {
        try {
            const r = await axios.get(`${url}/health`, { timeout: 500 });
            if (r.status === 200) {
                scores.push({ url, healthy: true });
            } else {
                scores.push({ url, healthy: false });
            }
        } catch {
            scores.push({ url, healthy: false });
        }
    }
    return scores;
}
let index = 0;

function selectBestInstance() {

    const target = instances[index % instances.length];

    index++;

    return target;
}

app.post("/fraud-check", async (req,res)=>{

    try{

        const nodes = await getHealthScores();
        console.log("Nodes:", nodes);

        let target;

        if (nodes && nodes.length > 0) {
            target = selectBest(nodes);
        }

        if (!target) {
            target = instances[0];
        }

        console.log("Routing to:", target);

        const response = await axios.post(
            `${target}/fraud-check`,
            req.body
        );

        res.json(response.data);

    }catch(err){
        console.error("ERROR:", err.message);
        res.status(500).send("routing error");
    }

});

app.listen(4000,()=>{
    console.log("Load Balancer running on port 4000");
});