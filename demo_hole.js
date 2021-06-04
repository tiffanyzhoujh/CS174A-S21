import {defs, tiny} from './examples/common.js';
import {Text_Line} from './examples/text-demo.js';
const {
    Vector, Vector3, vec, vec3, vec4, color, hex_color, Shader, Matrix, Mat4, Light, Shape, Material, Scene, Texture,
} = tiny;

export class Body {
    // **Body** can store and update the properties of a 3D body that incrementally
    // moves from its previous place due to velocities.  It conforms to the
    // approach outlined in the "Fix Your Timestep!" blog post by Glenn Fiedler.
    constructor(shape, material, size) {
        Object.assign(this,
            {shape, material, size})
    }

    // (within some margin of distance).
    static intersect_cube(p, margin = 0) {
        return p.every(value => value >= -1 - margin && value <= 1 + margin)
    }

    static intersect_sphere(p, margin = 0) {
        return p.dot(p) < 1 + margin;
    }

    emplace(location_matrix, linear_velocity, angular_velocity, spin_axis = vec3(0, 0, 0).randomized(1).normalized()) {                               // emplace(): assign the body's initial values, or overwrite them.
        this.center = location_matrix.times(vec4(0, 0, 0, 1)).to3();
        this.rotation = Mat4.translation(...this.center.times(-1)).times(location_matrix);
        this.previous = {center: this.center.copy(), rotation: this.rotation.copy()};
        // drawn_location gets replaced with an interpolated quantity:
        this.drawn_location = location_matrix;
        this.temp_matrix = Mat4.identity();
        return Object.assign(this, {linear_velocity, angular_velocity, spin_axis})
    }

    advance(time_amount) {
        // advance(): Perform an integration (the simplistic Forward Euler method) to
        // advance all the linear and angular velocities one time-step forward.
        this.previous = {center: this.center.copy(), rotation: this.rotation.copy()};
        // Apply the velocities scaled proportionally to real time (time_amount):
        // Linear velocity first, then angular:
        this.center = this.center.plus(this.linear_velocity.times(time_amount));
        this.rotation.pre_multiply(Mat4.rotation(time_amount * this.angular_velocity, ...this.spin_axis));
    }

    // The following are our various functions for testing a single point,
    // p, against some analytically-known geometric volume formula

    blend_rotation(alpha) {
        // blend_rotation(): Just naively do a linear blend of the rotations, which looks
        // ok sometimes but otherwise produces shear matrices, a wrong result.

        // TODO:  Replace this function with proper quaternion blending, and perhaps
        // store this.rotation in quaternion form instead for compactness.
        return this.rotation.map((x, i) => vec4(...this.previous.rotation[i]).mix(x, alpha));
    }

    blend_state(alpha) {
        // blend_state(): Compute the final matrix we'll draw using the previous two physical
        // locations the object occupied.  We'll interpolate between these two states as
        // described at the end of the "Fix Your Timestep!" blog post.
        this.drawn_location = Mat4.translation(...this.previous.center.mix(this.center, alpha))
            .times(this.blend_rotation(alpha))
            .times(Mat4.scale(...this.size));
    }

    check_if_colliding(b, collider) {
        // check_if_colliding(): Collision detection function.
        // DISCLAIMER:  The collision method shown below is not used by anyone; it's just very quick
        // to code.  Making every collision body an ellipsoid is kind of a hack, and looping
        // through a list of discrete sphere points to see if the ellipsoids intersect is *really* a
        // hack (there are perfectly good analytic expressions that can test if two ellipsoids
        // intersect without discretizing them into points).
        if (this == b)
            return false;
        // Nothing collides with itself.
        // Convert sphere b to the frame where a is a unit sphere:
        const T = this.inverse.times(b.drawn_location, this.temp_matrix);

        const {intersect_test, points, leeway} = collider;
        // For each vertex in that b, shift to the coordinate frame of
        // a_inv*b.  Check if in that coordinate frame it penetrates
        // the unit sphere at the origin.  Leave some leeway.
        return points.arrays.position.some(p =>
            intersect_test(T.times(p.to4(1)).to3(), leeway));
    }
}

export class Simulation extends Scene {
    // **Simulation** manages the stepping of simulation time.  Subclass it when making
    // a Scene that is a physics demo.  This technique is careful to totally decouple
    // the simulation from the frame rate (see below).
    constructor() {
        super();
        Object.assign(this, {time_accumulator: 0, time_scale: 1, t: 0, dt: 1 / 20, bodies: [], steps_taken: 0});
    }

    simulate(frame_time) {
        // simulate(): Carefully advance time according to Glenn Fiedler's
        // "Fix Your Timestep" blog post.
        // This line gives ourselves a way to trick the simulator into thinking
        // that the display framerate is running fast or slow:
        frame_time = this.time_scale * frame_time;

        // Avoid the spiral of death; limit the amount of time we will spend
        // computing during this timestep if display lags:
        this.time_accumulator += Math.min(frame_time, 0.1);
        // Repeatedly step the simulation until we're caught up with this frame:
        while (Math.abs(this.time_accumulator) >= this.dt) {
            // Single step of the simulation for all bodies:
            this.update_state(this.dt);
            for (let b of this.bodies)
                b.advance(this.dt);
            // Following the advice of the article, de-couple
            // our simulation time from our frame rate:
            this.t += Math.sign(frame_time) * this.dt;
            this.time_accumulator -= Math.sign(frame_time) * this.dt;
            this.steps_taken++;
        }
        // Store an interpolation factor for how close our frame fell in between
        // the two latest simulation time steps, so we can correctly blend the
        // two latest states and display the result.
        let alpha = this.time_accumulator / this.dt;
        for (let b of this.bodies) b.blend_state(alpha);
    }

    make_control_panel() {
        // make_control_panel(): Create the buttons for interacting with simulation time.
        this.key_triggered_button("Speed up time", ["Shift", "T"], () => this.time_scale *= 5);
        this.key_triggered_button("Slow down time", ["t"], () => this.time_scale /= 5);
        this.new_line();
        this.live_string(box => {
            box.textContent = "Time scale: " + this.time_scale
        });
        this.new_line();
        this.live_string(box => {
            box.textContent = "Fixed simulation time step size: " + this.dt
        });
        this.new_line();
        this.live_string(box => {
            box.textContent = this.steps_taken + " timesteps were taken so far."
        });
    }

    display(context, program_state) {
        // display(): advance the time and state of our whole simulation.
        if (program_state.animate)
            this.simulate(program_state.animation_delta_time);

        //For use when building physics part of scene -- comment out in final product
        // Draw bodies
        if(this.draw_bounding_box){
            for (let b of this.bodies) b.shape.draw(context, program_state, b.drawn_location, b.material);
        }

        this.ball.shape.draw(context, program_state, this.ball.drawn_location, this.ball.material)
    }

    update_state(dt)      // update_state(): Your subclass of Simulation has to override this abstract function.
    {
        throw "Override this"
    }
}

export class Shape_From_File extends Shape {                                   // **Shape_From_File** is a versatile standalone Shape that imports
                                                                               // all its arrays' data from an .obj 3D model file.
    constructor(filename) {
        super("position", "normal", "texture_coord");
        // Begin downloading the mesh. Once that completes, return
        // control to our parse_into_mesh function.
        this.load_file(filename);
    }

    load_file(filename) {                             // Request the external file and wait for it to load.
        // Failure mode:  Loads an empty shape.
        return fetch(filename)
            .then(response => {
                if (response.ok) return Promise.resolve(response.text())
                else return Promise.reject(response.status)
            })
            .then(obj_file_contents => this.parse_into_mesh(obj_file_contents))
            .catch(error => {
                this.copy_onto_graphics_card(this.gl);
            })
    }

    parse_into_mesh(data) {                           // Adapted from the "webgl-obj-loader.js" library found online:
        var verts = [], vertNormals = [], textures = [], unpacked = {};

        unpacked.verts = [];
        unpacked.norms = [];
        unpacked.textures = [];
        unpacked.hashindices = {};
        unpacked.indices = [];
        unpacked.index = 0;

        var lines = data.split('\n');

        var VERTEX_RE = /^v\s/;
        var NORMAL_RE = /^vn\s/;
        var TEXTURE_RE = /^vt\s/;
        var FACE_RE = /^f\s/;
        var WHITESPACE_RE = /\s+/;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            var elements = line.split(WHITESPACE_RE);
            elements.shift();

            if (VERTEX_RE.test(line)) verts.push.apply(verts, elements);
            else if (NORMAL_RE.test(line)) vertNormals.push.apply(vertNormals, elements);
            else if (TEXTURE_RE.test(line)) textures.push.apply(textures, elements);
            else if (FACE_RE.test(line)) {
                var quad = false;
                for (var j = 0, eleLen = elements.length; j < eleLen; j++) {
                    if (j === 3 && !quad) {
                        j = 2;
                        quad = true;
                    }
                    if (elements[j] in unpacked.hashindices)
                        unpacked.indices.push(unpacked.hashindices[elements[j]]);
                    else {
                        var vertex = elements[j].split('/');

                        unpacked.verts.push(+verts[(vertex[0] - 1) * 3 + 0]);
                        unpacked.verts.push(+verts[(vertex[0] - 1) * 3 + 1]);
                        unpacked.verts.push(+verts[(vertex[0] - 1) * 3 + 2]);

                        if (textures.length) {
                            unpacked.textures.push(+textures[((vertex[1] - 1) || vertex[0]) * 2 + 0]);
                            unpacked.textures.push(+textures[((vertex[1] - 1) || vertex[0]) * 2 + 1]);
                        }

                        unpacked.norms.push(+vertNormals[((vertex[2] - 1) || vertex[0]) * 3 + 0]);
                        unpacked.norms.push(+vertNormals[((vertex[2] - 1) || vertex[0]) * 3 + 1]);
                        unpacked.norms.push(+vertNormals[((vertex[2] - 1) || vertex[0]) * 3 + 2]);

                        unpacked.hashindices[elements[j]] = unpacked.index;
                        unpacked.indices.push(unpacked.index);
                        unpacked.index += 1;
                    }
                    if (j === 3 && quad) unpacked.indices.push(unpacked.hashindices[elements[0]]);
                }
            }
        }
        {
            const {verts, norms, textures} = unpacked;
            for (var j = 0; j < verts.length / 3; j++) {
                this.arrays.position.push(vec3(verts[3 * j], verts[3 * j + 1], verts[3 * j + 2]));
                this.arrays.normal.push(vec3(norms[3 * j], norms[3 * j + 1], norms[3 * j + 2]));
                this.arrays.texture_coord.push(vec(textures[2 * j], textures[2 * j + 1]));
            }
            this.indices = unpacked.indices;
        }
        this.normalize_positions(false);
        this.ready = true;
    }

    draw(context, program_state, model_transform, material) {               // draw(): Same as always for shapes, but cancel all
        // attempts to draw the shape before it loads:
        if (this.ready)
            super.draw(context, program_state, model_transform, material);
    }
}


export class demoHole extends Simulation {
    constructor() {
        // constructor(): Scenes begin by populating initial values like the Shapes and Materials they'll need.
        super();

        //Flags
        this.ball_stop_flag = false;

        // *** Shapes
        this.shapes = {
            torus: new defs.Torus(15, 15),
            torus2: new defs.Torus(3, 15),
            sphere: new defs.Subdivision_Sphere(4),
            // "sphere": new Shape_From_File("assets/football_plain.obj"),
            circle: new defs.Regular_2D_Polygon(1, 15),
            cube: new defs.Cube(),
            square: new defs.Square(),
            sky: new defs.Square(),
            ceiling: new defs.Square(),
            ground: new defs.Square(),
            landscape: new defs.Square(),
            // courses
            "course_1": new Shape_From_File("assets/course/course_1_plain.obj"),
            "course_2": new Shape_From_File("assets/course/course_2_plain.obj"),
            "course_3": new Shape_From_File("assets/course/course_3_nonplain.obj"),
            // flag
            cylinder: new defs.Capped_Cylinder(20, 20),
            triangle: new defs.Triangle(),
            // background
            "stone": new Shape_From_File("assets/background/stone_1_plain.obj"),
            "grass1": new Shape_From_File("assets/background/grass1.obj"),
            "grass2": new Shape_From_File("assets/background/grass2.obj"),
            "grass3": new Shape_From_File("assets/background/grass3.obj"),
            "grass4": new Shape_From_File("assets/background/grass4_plain.obj"),
            "grass5": new Shape_From_File("assets/background/grass5.obj"),
            "grass6": new Shape_From_File("assets/background/grass6.obj"),
            "grass7": new Shape_From_File("assets/background/grass7.obj"),
            "grass8": new Shape_From_File("assets/background/grass8.obj"),
            "grass9": new Shape_From_File("assets/background/grass9.obj"),
            "grass10": new Shape_From_File("assets/background/grass10.obj"),
            "grass11": new Shape_From_File("assets/background/grass11.obj"),
            "grass12": new Shape_From_File("assets/background/grass12.obj"),
            "grass13": new Shape_From_File("assets/background/grass13.obj"),
            "grass14": new Shape_From_File("assets/background/grass14.obj"),
            "grass15": new Shape_From_File("assets/background/grass15.obj"),
            //text
            text: new Text_Line(35),
            "congrats": new Shape_From_File("assets/course/congrats.obj"),
            "names": new Shape_From_File("assets/course/names.obj"),
        };

        // zoom out the image texture
        this.shapes.ground.arrays.texture_coord.forEach(
            (v, i, l) =>
                l[i] = vec( 4 * v[0],  4 * v[1])
        );

        this.shapes.ceiling.arrays.texture_coord.forEach(
            (v, i, l) =>
                l[i] = vec( 1*v[0],  1*v[1])
        );

        // *** Materials
        this.materials = {
            test: new Material(new defs.Phong_Shader(),
                {ambient: .4, diffusivity: .6, specularity: 0, color: hex_color("#9BDB95")}),

            test2: new Material(new defs.Fake_Bump_Map(1),
                {ambient: 0, diffusivity: 1, specularity: 0, color: hex_color("#ffffff")}),

            ball: new Material(new defs.Phong_Shader(1),
                {ambient: 0.2, diffusivity: 1, specularity: 1, color: hex_color("#ffffff")}),

            indicator: new Material(new defs.Phong_Shader(),
                {ambient: 0.5, diffusivity: 0.9, specularity: 0.5, color: hex_color("#ffffff")}),
            shadow: new Material(new defs.Phong_Shader(),
                {ambient: 0.5, diffusivity: 1, specularity: 0, color: hex_color("#404040")}),

            // courses
            course_1: new Material(new defs.Fake_Bump_Map(1),
                {ambient: 1, diffusivity: 1, specularity: 1, texture: new Texture("assets/course/course_1.png")}),
            course_2: new Material(new defs.Fake_Bump_Map(1),
                {ambient: 1, diffusivity: 1, specularity: 1, texture: new Texture("assets/course/course_2.png")}),
            course_3: new Material(new defs.Fake_Bump_Map(1),
                {ambient: 1, diffusivity: 1, specularity: 1, texture: new Texture("assets/course/course_3.png")}),
            gray: new Material(new defs.Phong_Shader(),
                {ambient: 0.8, diffusivity: 0.5, specularity: 0.1, color: hex_color("#99a3a4")}),
            red: new Material(new defs.Phong_Shader,
                {ambient: 0.6, diffusivity: 0.5, specularity: 0.1, color: hex_color("#C52929")}),
            // background
            soil_grass: new Material(new defs.Fake_Bump_Map(1),
                {ambient: 0.7, diffusivity: 0.7, specularity: 0.1, texture: new Texture("assets/background/grass.jpg")}),
            sky2: new Material(new defs.Fake_Bump_Map(1),
                {ambient: 1, diffusivity: 0.5, specularity: 0, texture: new Texture("assets/background/sky2.jpg")}),
            grass: new Material(new defs.Fake_Bump_Map(1),
                {ambient: 0.5, diffusivity: 0, specularity: 0, texture: new Texture("assets/background/Green_Grass.png")}),
            grass_color: new Material(new defs.Phong_Shader,
                {ambient: .8, diffusivity: 0.5, specularity: 0.1, color: hex_color("#777F46")}),
            stone: new Material(new defs.Fake_Bump_Map(1),
                {ambient: 1, diffusivity: 0, specularity: 0, texture: new Texture("assets/background/stone_1.png")}),
            landscape4: new Material(new defs.Fake_Bump_Map(1),
                {ambient: 1, diffusivity: 0, specularity: 0, texture: new Texture("assets/background/landscape4.jpg")}),
            landscape5: new Material(new defs.Fake_Bump_Map(1),
                {ambient: 1, diffusivity: 0, specularity: 0, texture: new Texture("assets/background/landscape5.jpg")}),
            // football: new Material(new defs.Fake_Bump_Map(1),
            //     {ambient: 1, diffusivity: 0, specularity: 0, texture: new Texture("assets/football_small_margin2.png")}),
        }

        // Import font
        this.text_image = new Material(new defs.Textured_Phong(2), {
            ambient: 1, diffusivity: 0, specularity: 0,
            texture: new Texture("assets/text.png")
        });

        // *** Camera Location
        this.initial_camera_location = Mat4.look_at(vec3(0, 10, -30), vec3(0, 0, 20), vec3(0, 1, 0));
        // this.initial_camera_location = Mat4.look_at(vec3(0, 40, -175), vec3(0, 0, 20), vec3(0, 1, 0)); // background testing

        // *** Level flags
        this.level = 1;
        this.score = 0;

        this.canv = document.querySelector("#main-canvas");
        this.scoreNode = document.createTextNode("Score: " + this.score);
        this.canv.appendChild(this.scoreNode);

        this.updateScores();

        // *** Physics Objects
        this.setupHole();

        // *** Hole location
        this.hole_pos = vec3(0,0,10);
        this.hole_rad = 1;

        // *** Game state flags
        this.game_win = false;

        // *** Control flags
        this.power =  50.0;
        this.aim = Math.PI/2.0;

        // *** testing flag -- set to false in final product
        this.draw_bounding_box = false;

        // *** Collection of grass
        this.set_grass();

        // *** Generate random numbers
        this.random_init();

        // *** Audio play
        this.bgm = new Audio();
        this.bgm.src = "./assets/audio/Equality 7-2521.m4a";
        this.bgmpaused = true;
        this.hit = new Audio();
        this.hit.src = "./assets/audio/hitball.mp3";
    }

    // store grass models and colors
    set_grass(){
        this.grass_collection = [
            this.shapes.grass1, this.shapes.grass2, this.shapes.grass3, this.shapes.grass4, this.shapes.grass5, this.shapes.grass6, this.shapes.grass7, this.shapes.grass8,
            this.shapes.grass9, this.shapes.grass10, this.shapes.grass11, this.shapes.grass12, this.shapes.grass13, this.shapes.grass14, this.shapes.grass15
        ];
        this.grass_colors = [hex_color("#777F46"), hex_color("#727B50"), hex_color("#374008"), hex_color("#4B5516")];
    }

    // initialize random numbers
    random_init(){
        this.random = [];
        let i = 0;
        for(i = 0; i < 100; i++)
            this.random.push(Math.random());
    }

    //hard coded physics objects for walls
    setupHole(){
        this.ball_stop_flag = false;
        this.bodies = [];
        
        if(this.level == 1){
            this.ball = new Body(this.shapes.sphere, this.materials.ball, vec3(0.5, 0.5, 0.5))
                        .emplace(Mat4.translation(0,10,-10), vec3(0, -1, 0), 0)

            this.bodies.push(this.ball);

            //this.ball_shadow = new Body(this.shapes.circle, this.materials.shadow, vec3(0.5,0.5,0.5))
            //            .emplace(Mat4.translation(0,10,-10), vec3(0, -1, 0), 0)
            
            //this.bodies.push(this.ball_shadow);

            this.w1 = new Body(this.shapes.cube, this.materials.test2, vec3(1,2,16))
                        .emplace(Mat4.translation(6,1,0), vec3(0,0,0), 0)
            this.bodies.push(this.w1);

            this.w2 = new Body(this.shapes.cube, this.materials.test2, vec3(1,2,16))
                        .emplace(Mat4.translation(-6,1,0), vec3(0,0,0), 0)
            this.bodies.push(this.w2);

            this.w3 = new Body(this.shapes.cube, this.materials.test2, vec3(5,2,1))
                        .emplace(Mat4.translation(0,1,15), vec3(0,0,0), 0)
            this.bodies.push(this.w3);

            this.w4 = new Body(this.shapes.cube, this.materials.test2, vec3(5,2,1))
                        .emplace(Mat4.translation(0,1,-15), vec3(0,0,0), 0)
            this.bodies.push(this.w4);
        }

        if(this.level == 2){
            this.ball = new Body(this.shapes.sphere, this.materials.ball, vec3(0.5, 0.5, 0.5))
                        .emplace(Mat4.translation(0,10,-10), vec3(0, -1, 0), 0)

            this.bodies.push(this.ball);

            //leftside
            this.w1 = new Body(this.shapes.cube, this.materials.test2, vec3(1,2,8))
                        .emplace(Mat4.translation(6,1,-8), vec3(0,0,0), 0)
            this.bodies.push(this.w1);

            this.w2 = new Body(this.shapes.cube, this.materials.test2, vec3(3,2,1))
                        .emplace(Mat4.translation(8,1,1), vec3(0,0,0), 0)
            this.bodies.push(this.w2);

            this.w3 = new Body(this.shapes.cube, this.materials.test2, vec3(1,2,5))
                        .emplace(Mat4.translation(12,1,5), vec3(0,0,0), 0)
            this.bodies.push(this.w3);
            
            this.w4 = new Body(this.shapes.cube, this.materials.test2, vec3(3,2,1))
                        .emplace(Mat4.translation(8,1,9), vec3(0,0,0), 0)
            this.bodies.push(this.w4);
            
            this.w5 = new Body(this.shapes.cube, this.materials.test2, vec3(1,2,3))
                        .emplace(Mat4.translation(6,1,13), vec3(0,0,0), 0)
            this.bodies.push(this.w5);

            //rightside
            this.w6 = new Body(this.shapes.cube, this.materials.test2, vec3(1,2,8))
                        .emplace(Mat4.translation(-6,1,-8), vec3(0,0,0), 0)
            this.bodies.push(this.w6);

            this.w7 = new Body(this.shapes.cube, this.materials.test2, vec3(3,2,1))
                        .emplace(Mat4.translation(-8,1,1), vec3(0,0,0), 0)
            this.bodies.push(this.w7);

            this.w8 = new Body(this.shapes.cube, this.materials.test2, vec3(1,2,5))
                        .emplace(Mat4.translation(-12,1,5), vec3(0,0,0), 0)
            this.bodies.push(this.w8);
            
            this.w9 = new Body(this.shapes.cube, this.materials.test2, vec3(3,2,1))
                        .emplace(Mat4.translation(-8,1,9), vec3(0,0,0), 0)
            this.bodies.push(this.w9);
            
            this.w10 = new Body(this.shapes.cube, this.materials.test2, vec3(1,2,3))
                        .emplace(Mat4.translation(-6,1,13), vec3(0,0,0), 0)
            this.bodies.push(this.w10);

            //top/bottom
            this.w11 = new Body(this.shapes.cube, this.materials.test2, vec3(5,2,1))
                        .emplace(Mat4.translation(0,1,15), vec3(0,0,0), 0)
            this.bodies.push(this.w11);
            
            this.w12 = new Body(this.shapes.cube, this.materials.test2, vec3(5,2,1))
                        .emplace(Mat4.translation(0,1,-15), vec3(0,0,0), 0)
            this.bodies.push(this.w12);

            //center block
            this.w13 = new Body(this.shapes.cube, this.materials.test2, vec3(1,2,1))
                        .emplace(Mat4.translation(0,1,5).times(Mat4.rotation(Math.PI/4,0,1,0)), vec3(0,0,0), 0)
            this.bodies.push(this.w13);
        }

        if(this.level == 3){
            this.ball = new Body(this.shapes.sphere, this.materials.ball, vec3(0.5, 0.5, 0.5))
                        .emplace(Mat4.translation(0,10,-10), vec3(0, -1, 0), 0)

            this.bodies.push(this.ball);

            this.w1 = new Body(this.shapes.cube, this.materials.test2, vec3(1,2,16))
                        .emplace(Mat4.translation(6,1,0), vec3(0,0,0), 0)
            this.bodies.push(this.w1);

            this.w2 = new Body(this.shapes.cube, this.materials.test2, vec3(1,2,16))
                        .emplace(Mat4.translation(-6,1,0), vec3(0,0,0), 0)
            this.bodies.push(this.w2);

            this.w3 = new Body(this.shapes.cube, this.materials.test2, vec3(5,2,1))
                        .emplace(Mat4.translation(0,1,15), vec3(0,0,0), 0)
            this.bodies.push(this.w3);

            this.w4 = new Body(this.shapes.cube, this.materials.test2, vec3(5,2,1))
                        .emplace(Mat4.translation(0,1,-15), vec3(0,0,0), 0)
            this.bodies.push(this.w4);

            //obstacles
            this.w5 = new Body(this.shapes.cube, this.materials.test2, vec3(2,2,2))
                        .emplace(Mat4.translation(3,1,0), vec3(0,0,0), 0)
            this.bodies.push(this.w5);
            this.w6 = new Body(this.shapes.cube, this.materials.test2, vec3(2,2,2))
                        .emplace(Mat4.translation(-3,1,0), vec3(0,0,0), 0)
            this.bodies.push(this.w6);

            //bridge
            this.b1 = new Body(this.shapes.cube, this.materials.test2, vec3(1,0.5,2))
                    .emplace(Mat4.translation(0,1.45,0), vec3(0,0,0), 0)
            this.bodies.push(this.b1);

            this.b2 = new Body(this.shapes.cube, this.materials.test2, vec3(1.12,0.5,1.25))
                    .emplace(Mat4.translation(0,1.05,-2.9).times(Mat4.rotation(0.46365,-1,0,0)), vec3(0,0,0), 0)
            this.bodies.push(this.b2);
        }

        else if(this.level == 4){
            this.ball = new Body(this.shapes.sphere, this.materials.ball, vec3(0.5, 0.5, 0.5))
                        .emplace(Mat4.translation(20,20,0), vec3(0, -1, 0), 0)

            this.bodies.push(this.ball);
        }

    }

    updateScores(){
        this.scoreNode.nodeValue = "Score: " + this.score;
    }


    make_control_panel() {
        // Draw the scene's buttons, setup their actions and keyboard shortcuts, and monitor live measurements.
        
        //For demo purposes, simply move ball up/down/left/right
        this.key_triggered_button("Aim counter-clockwise (b)", ["b"], () => {
            this.aim -= 0.05;
            });
        
        this.key_triggered_button("Aim clockwise (n)", ["n"], () => {
            this.aim += 0.05;
            });

        this.key_triggered_button("Increase Power (+)", ["="], () => {
            this.power = Math.min(this.power + 4.0, 100.0);
            });

        this.key_triggered_button("Decrease Power (-)", ["-"], () => {
            this.power = Math.max(this.power - 4.0, 0.0);
            });

        this.key_triggered_button("Hit ball (h)", ["h"], () => {
            if(this.ball_stop_flag){
                this.ball_stop_flag = false;
                this.ball.linear_velocity[0] = Math.cos(this.aim) * this.power/20.0;
                this.ball.linear_velocity[2] = Math.sin(this.aim) * this.power/20.0;
            }
            this.score++;
            this.updateScores();
            this.hit.play();
            });

        // controls for levels
        this.key_triggered_button("Level 1", ["x"], () => {
            this.level = 1;
            this.setupHole();
        });
        this.key_triggered_button("Level 2", ["c"], () => {
            this.level = 2;
            this.setupHole();
        });
        this.key_triggered_button("Level 3", ["v"], () => {
            this.level = 3;
            this.setupHole();
        });

        // controls for cameras
        this.key_triggered_button("Default view", ["Control", "d"], () => this.attached = () => "default");
        this.key_triggered_button("View course", ["Control", "c"], () => this.attached = () => "course");
        this.key_triggered_button("View hole", ["Control", "h"], () => this.attached = () => this.view_hole);
        this.key_triggered_button("View scene", ["Control", "s"], () => this.attached = () => "scene");
        this.key_triggered_button("View ball", ["Control", "b"], () => this.attached = () => "view_ball");

        // attach to ball?
        // this.key_triggered_button("Attach to ball", ["Control", "b"], () => this.attached = () => this.view_ball);

        // controls for music
        this.key_triggered_button("Music", ["m"], () => {
            if(this.bgmpaused == true){
                this.bgm.play();
                this.bgmpaused = false;
            }
            else{
                this.bgm.pause();
                this.bgmpaused = true;
            }
        });

    }

    //check if ball b intersects with cube c
    //returns the normal vector to the face of intersecting the ball
    //will return 45 degree "normals" if the ball perfectly inersects a corner
    //returns undefined if not intersect
    sphere_cube_collision(b, c){
        //convert coordinates so cube is centered and aligned with axis
        const inv = Mat4.inverse(c.rotation).times(
                Mat4.translation(-c.center[0],-c.center[1],-c.center[2]));

        const tb = inv.times(vec4(b.center[0], b.center[1], b.center[2], 1));
        
        //console.log(tb);
        var x = Math.max(-c.size[0], Math.min(tb[0], c.size[0]));
        var y = Math.max(-c.size[1], Math.min(tb[1], c.size[1]));
        var z = Math.max(-c.size[2], Math.min(tb[2], c.size[2]));

        const dist = Math.sqrt( (x - tb[0])**2 +
                                (y - tb[1])**2 +
                                (z - tb[2])**2 );

        if(dist < b.size[0]){
            var nx = 0;
            var ny = 0;
            var nz = 0;
            if(x == -c.size[0]){
                nx = -1;
            }else if(x == c.size[0]){
                nx = 1;
            }

            if(y == -c.size[1]){
                ny = -1;
            }else if(y == c.size[1]){
                ny = 1;
            }

            if(z == -c.size[2]){
                nz = -1;
            }else if(z == c.size[2]){
                nz = 1;
            }

            //console.log(vec3(x,y,z))
            return c.rotation.times(vec4(nx,ny,nz,0)).normalized().to3();
        }

        return undefined;

    }

    update_state(dt) {
            
        if(this.ball_stop_flag) return;

        if((this.ball.center[0]-this.hole_pos[0])**2 + (this.ball.center[2]-this.hole_pos[2])**2 <= this.hole_rad**2 && this.ball.center[1] < 1.5)
        {
            //compute physics of game hole
            if((this.ball.center[0]-this.hole_pos[0])**2 + (this.ball.center[2]-this.hole_pos[2])**2 > (this.hole_rad-0.5)**2){
                let norm = vec3(
                    this.hole_pos[0]-this.ball.center[0],
                    0,
                    this.hole_pos[2]-this.ball.center[2]
                ).normalized();
                let projection = this.ball.linear_velocity.dot(norm);
                if(projection < 0){
                    this.ball.linear_velocity = this.ball.linear_velocity.minus(
                        norm.times(projection)
                    );
                }
            }

            this.game_win = true;
        }

        //setup next hole on win
        if(this.ball.center[1] < -1){
            this.game_win = false;
            // if(this.level <= 2){
                this.level = (this.level)%4 + 1
                this.setupHole();
            // }
            // else{
            //     this.level = 4;
            // }
        }


        this.ball.linear_velocity[1] += dt * -3.7;
        // If about to fall through floor, reverse y velocity:
        if (this.ball.center[1] < 1.5 && this.ball.linear_velocity[1] < 0 && !this.game_win)
            this.ball.linear_velocity[1] *= -0.5;

        //apply friction -- currently using estimated value
        const fric = 2.71828**(-dt/10)

        this.ball.linear_velocity[0] *= fric;
        this.ball.linear_velocity[1] *= fric;
        this.ball.linear_velocity[2] *= fric;

        for(let b of this.bodies){
            b.inverse = Mat4.inverse(b.drawn_location);
            if(this.ball == b) continue;

            const norm = this.sphere_cube_collision(this.ball, b);

            if(norm != undefined){
                //console.log(norm);
                let projection = this.ball.linear_velocity.dot(norm)/this.ball.linear_velocity.norm();
                if(projection > 0) continue;
                
                //special handling for slopes
                if(Math.abs(norm[1]) > Math.abs(norm[0]) && Math.abs(norm[1]) > Math.abs(norm[2])){
                    
                    let prev_velocity = Math.sqrt(
                        this.ball.linear_velocity[0]**2 + 
                        this.ball.linear_velocity[1]**2 + 
                        this.ball.linear_velocity[2]**2);
                    
                    this.ball.linear_velocity = this.ball.linear_velocity.minus(
                        norm.times(this.ball.linear_velocity.dot(norm))
                    );

                }else{
                    this.ball.linear_velocity = 
                        this.ball.linear_velocity.minus(
                            norm.times(2).times(this.ball.linear_velocity.dot(norm)));
                        
                    //ball loses some velocity based on angle of hit
                    this.ball.linear_velocity.times(0.7-0.3*projection);
                }
                //console.log(this.ball.linear_velocity);
            }
        }


        //stop the ball when it reaches a slow enough speed
        if(this.ball.linear_velocity.norm() < 0.2 && this.ball.center[1] < 1.55){
            this.ball_stop_flag = true;
            this.ball.linear_velocity = vec3(0,0,0);
            console.log("ball stop");
        }

    }

    // draw courses
    draw_course(context, program_state, model_transform, level){

        if( level == 2 ){
            let scale_factor = 7.82;
            let floor_transform = Mat4.translation(0.1,0.69,5.9)
                .times(Mat4.scale(scale_factor,scale_factor,scale_factor))
            this.shapes.course_2.draw(context, program_state, floor_transform, this.materials.course_2);

            // flag
            let cylinder_transform = model_transform
                .times(Mat4.translation(0, 7, 13))
                .times(Mat4.rotation(1.57, 1, 0, 0))
                .times(Mat4.scale(.1, .1, 15))
            ;
                 
            this.shapes.cylinder.draw(context, program_state, cylinder_transform, this.materials.gray);
            
            //flag shadow 
            let cylinder_shadow_transform = model_transform.times(Mat4.translation(-0.6, 1.07, 13.6))
                                            .times(Mat4.rotation(1.57, 1, 0, 0))
                                            .times(Mat4.rotation(0.8,0,0,-1))
                                            .times(Mat4.scale(0.9,.1,1))
                                            ;
            this.shapes.square.draw(context, program_state,cylinder_shadow_transform, this.materials.shadow);
            
            let cylinder_shadow_transform_2 = model_transform.times(Mat4.translation(-1.01, 2, 14))
                                              .times(Mat4.rotation(1.57, 0, 0, 1))
                                              .times(Mat4.scale(1.1,.1,1))
                                              ;
            this.shapes.square.draw(context, program_state,cylinder_shadow_transform_2, this.materials.shadow);                                  
            
            let cylinder_shadow_transform_3 = model_transform.times(Mat4.translation(-1.95, 3.1, 15))
                                              .times(Mat4.rotation(1.57, 1, 0, 0))
                                              .times(Mat4.rotation(-0.785, 0, 0, 1))
                                              .times(Mat4.scale(1.4,.1,1))
                                              ;
            this.shapes.square.draw(context, program_state,cylinder_shadow_transform_3, this.materials.shadow);                                  
            
            let triangle_transform = model_transform
                .times(Mat4.translation(0, 12.5, 13))
                .times(Mat4.rotation(3.14, 0, 1, 0))
                .times(Mat4.scale(4, 2, 1))
            ;
            this.shapes.triangle.draw(context, program_state, triangle_transform, this.materials.red);
        }
        else if(level == 3){
            let scale_factor = 9.02;
            let floor_transform = Mat4.translation(0.03,0.7,4.05)
                .times(Mat4.scale(scale_factor,scale_factor,scale_factor))
            this.shapes.course_3.draw(context, program_state, floor_transform, this.materials.course_3);

            // flag
            let cylinder_transform = model_transform
                .times(Mat4.translation(0, 7, 13))
                .times(Mat4.rotation(1.57, 1, 0, 0))
                .times(Mat4.scale(.1, .1, 15))
            ;
            this.shapes.cylinder.draw(context, program_state, cylinder_transform, this.materials.gray);
              //flag shadow 
            let cylinder_shadow_transform = model_transform.times(Mat4.translation(-0.6, 1.0, 13.6))
                                            .times(Mat4.rotation(1.57, 1, 0, 0))
                                            .times(Mat4.rotation(0.8,0,0,-1))
                                            .times(Mat4.scale(0.9,.1,1))
                                            ;
            this.shapes.square.draw(context, program_state,cylinder_shadow_transform, this.materials.shadow);
            let cylinder_shadow_transform_2 = model_transform.times(Mat4.translation(-1.01, 2, 14))
                                              .times(Mat4.rotation(1.57, 0, 0, 1))
                                              .times(Mat4.scale(1.1,.1,1))
                                              ;
            this.shapes.square.draw(context, program_state,cylinder_shadow_transform_2, this.materials.shadow);                                  
            
            let cylinder_shadow_transform_3 = model_transform.times(Mat4.translation(-1.95, 3.1, 14.98))
                                              .times(Mat4.rotation(1.57, 1, 0, 0))
                                              .times(Mat4.rotation(-0.785, 0, 0, 1))
                                              .times(Mat4.scale(1.36,.1,1))
                                              ;
            this.shapes.square.draw(context, program_state,cylinder_shadow_transform_3, this.materials.shadow);                                  
            
            let triangle_transform = model_transform
                .times(Mat4.translation(0, 12.5, 13))
                .times(Mat4.rotation(3.14, 0, 1, 0))
                .times(Mat4.scale(4, 2, 1))
            ;
            this.shapes.triangle.draw(context, program_state, triangle_transform, this.materials.red);
        }
        else if (level == 4){
            let congrats_transform = Mat4.translation(8, 2.5, 20)
                .times(Mat4.scale(15,15,15))
                .times(Mat4.rotation(0.5*Math.PI, 0, 1, 0));

            this.shapes.congrats.draw(context, program_state, congrats_transform, this.materials.sky2);

            let names_transform = Mat4.translation(-2, 0.25, -5)
                .times(Mat4.scale(7,7,7))
                .times(Mat4.rotation(0.5*Math.PI, 0, 1, 0));
            this.shapes.names.draw(context, program_state, names_transform, this.materials.sky2);

        }
        else{ // level 1
            let scale_factor = 7.591;
            let floor_transform = Mat4.translation(0,0.4,6.812)
                .times(Mat4.scale(scale_factor,scale_factor,scale_factor))

            this.shapes.course_1.draw(context, program_state, floor_transform, this.materials.course_1);

            // flag
            let cylinder_transform = model_transform
                .times(Mat4.translation(0, 7, 13))
                .times(Mat4.rotation(1.57, 1, 0, 0))
                .times(Mat4.scale(.1, .1, 15))
            ;
            this.shapes.cylinder.draw(context, program_state, cylinder_transform, this.materials.gray);

            //flag shadow
            let cylinder_shadow_transform = model_transform.times(Mat4.translation(-0.6, 1.05, 13.6))
                                            .times(Mat4.rotation(1.57, 1, 0, 0))
                                            .times(Mat4.rotation(0.8,0,0,-1))
                                            .times(Mat4.scale(0.9,.1,1))
                                            ;
            this.shapes.square.draw(context, program_state,cylinder_shadow_transform, this.materials.shadow);
            let cylinder_shadow_transform_2 = model_transform.times(Mat4.translation(-0.97, 2, 13.99))
                                              .times(Mat4.rotation(1.57, 0, 0, 1))
                                              .times(Mat4.scale(1.1,.1,1))
                                              ;
            this.shapes.square.draw(context, program_state,cylinder_shadow_transform_2, this.materials.shadow);                                  
            
            let cylinder_shadow_transform_3 = model_transform.times(Mat4.translation(-1.9, 3.1, 14.95))
                                              .times(Mat4.rotation(1.57, 1, 0, 0))
                                              .times(Mat4.rotation(-0.785, 0, 0, 1))
                                              .times(Mat4.scale(1.4,.1,1))
                                              ;
            this.shapes.square.draw(context, program_state,cylinder_shadow_transform_3, this.materials.shadow);                                  
            
            let triangle_transform = model_transform
                .times(Mat4.translation(0, 10.5, 13))
                .times(Mat4.rotation(3.14, 0, 1, 0))
                .times(Mat4.scale(4, 2, 1))
            ;
            this.shapes.triangle.draw(context, program_state, triangle_transform.times(Mat4.translation(0,1,0)), this.materials.red);
        }
    }

    // helper function of draw_background
    draw_grass(context, program_state, model_transform, t, x_pos, z_pos, row, col, size){
        let x_scale = 0.1*(size+1);
        let yz_scale = 0.3*(size+1);
        let y_pos = 0;
        if(size == 1) y_pos = -0.2;
        else if(size == 1) y_pos = 0.8;

        let j = 0, i = 0;
        let grass_transform = Mat4.rotation(Math.PI, 0, 1, 0)
            .times(Mat4.translation(x_pos,y_pos, z_pos))
            .times(Mat4.scale(x_scale, yz_scale, yz_scale));
        let angle = 0.1*Math.sin(2.0 * t);
        let randcount = 0;
        for(i = 1; i < row; i++){
            for(j = 0; j < col; j++){
                let k = this.random[randcount];
                k = Math.floor(15* k);
                grass_transform = grass_transform.times(Mat4.translation(1,0, 0));
                this.grass_collection[k].draw(context, program_state,
                    grass_transform
                        .times(Mat4.translation(0, -2, 1))
                        .times(Mat4.rotation(angle, 0, 0, 1))
                        .times(Mat4.translation(0,2, 0))
                    , this.materials.grass_color.override({color: this.grass_colors[k%4]}));
                randcount++;
                randcount = randcount % 100;
            }
            let x_shift = i%2;
            grass_transform = Mat4.rotation(Math.PI, 0, 1, 0)
                .times(Mat4.translation(x_pos+x_shift*0.5,y_pos, z_pos+i*0.5))
                .times(Mat4.scale(x_scale, yz_scale, yz_scale));
        }
    }

    // draw the scene: sky, landscape, ground, grass, stones
    draw_background(context, program_state, model_transform, t){

        // cloud
        // let cloud_transform = Mat4.translation(0,20, 100).times(Mat4.scale(10, 10, 0));
        // this.shapes.cloud.draw(context, program_state, cloud_transform, this.materials.cloud_1);

        // stone
        let stone_transform = Mat4.translation(-23,0, 10)
            .times(Mat4.scale(3, 3, 3));
        this.shapes.stone.draw(context, program_state, stone_transform, this.materials.stone);

        // draw groups of grass with random shapes & colors
        this.draw_grass(context, program_state, model_transform, t, -15, -20, 3, 3, 3);
            this.draw_grass(context, program_state, model_transform, t, -15, -20, 10, 10, 2);
            this.draw_grass(context, program_state, model_transform, t, -15, -18, 3, 3, 1);
        this.draw_grass(context, program_state, model_transform, t, 20, -20, 3, 5, 3);
            this.draw_grass(context, program_state, model_transform, t, 20, -18, 10, 10, 2);
            this.draw_grass(context, program_state, model_transform, t, 20, -17, 3, 3, 1);
            this.draw_grass(context, program_state, model_transform, t, 13, -10, 3, 20, 1);
        this.draw_grass(context, program_state, model_transform, t, -25, -30, 3, 15, 2);
        this.draw_grass(context, program_state, model_transform, t, -13, 10, 3, 3, 1);
        this.draw_grass(context, program_state, model_transform, t, 10, -60, 3, 10, 1);

        // this.draw_grass(context, program_state, model_transform, t, -13, 10, 3, 3, 1);
        // this.draw_grass(context, program_state, model_transform, t, 13, -10, 3, 20, 1);

        // sky
        let sky_1_transform = Mat4.translation(0,50,75).times(Mat4.scale(100,100,100)).times(Mat4.rotation(2.3,1,0,0)).times(Mat4.rotation(1*Math.PI,0,0,1));
        let sky_2_transform = Mat4.translation(0,55,50).times(Mat4.scale(75,100,100)).times(Mat4.rotation(-1.57,1,0,0));
        let sky_3_transform = Mat4.translation(67.6,60,30).times(Mat4.scale(100,100,100)).times(Mat4.rotation(3.14,1,0,1)).times(Mat4.rotation(0.3,1,0,0)).times(Mat4.rotation(1*Math.PI,0,0,1));
        let sky_4_transform = Mat4.translation(-67.6,60,30).times(Mat4.scale(100,100,100)).times(Mat4.rotation(3.14,1,0,1)).times(Mat4.rotation(-0.3,1,0,0)).times(Mat4.rotation(1*Math.PI,0,0,1));
        this.shapes.sky.draw(context, program_state, sky_1_transform, this.materials.sky2); // back
        this.shapes.ceiling.draw(context, program_state, sky_2_transform, this.materials.sky2); // top
        this.shapes.square.draw(context, program_state, sky_3_transform, this.materials.sky2); // left
        this.shapes.square.draw(context, program_state, sky_4_transform, this.materials.sky2); // right

        // landscape
        // back
        let ls_1_transform = Mat4.translation(40,0,105)
            .times(Mat4.scale(40,40,0))
            .times(Mat4.rotation(2.3,1,0,0))
            .times(Mat4.rotation(Math.PI,0,0,1));
        this.shapes.landscape.draw(context, program_state, ls_1_transform, this.materials.landscape4);
        let ls_2_transform = Mat4.translation(-40,0,105)
            .times(Mat4.scale(40,40,0))
            .times(Mat4.rotation(2.3,1,0,0))
            .times(Mat4.rotation(Math.PI,0,0,1));
        this.shapes.landscape.draw(context, program_state, ls_2_transform, this.materials.landscape5);
        // left
        let ls_3_transform = Mat4.translation(79,0,65)
            .times(Mat4.rotation(1.5*Math.PI,0,1,0))
            .times(Mat4.scale(40,40,0))
            .times(Mat4.rotation(2.3,1,0,0))
            .times(Mat4.rotation(Math.PI,0,0,1));
        this.shapes.landscape.draw(context, program_state, ls_3_transform, this.materials.landscape4);
        let ls_4_transform = Mat4.translation(79,0,-15)
            .times(Mat4.rotation(1.5*Math.PI,0,1,0))
            .times(Mat4.scale(40,40,0))
            .times(Mat4.rotation(2.3,1,0,0))
            .times(Mat4.rotation(Math.PI,0,0,1));
        this.shapes.landscape.draw(context, program_state, ls_4_transform, this.materials.landscape5);
        // right
        let ls_5_transform = Mat4.translation(-79,0,65)
            .times(Mat4.rotation(0.5*Math.PI,0,1,0))
            .times(Mat4.scale(40,40,0))
            .times(Mat4.rotation(2.3,1,0,0))
            .times(Mat4.rotation(Math.PI,0,0,1));
        this.shapes.landscape.draw(context, program_state, ls_5_transform, this.materials.landscape5);
        let ls_6_transform = Mat4.translation(-79,0,-15)
            .times(Mat4.rotation(0.5*Math.PI,0,1,0))
            .times(Mat4.scale(40,40,0))
            .times(Mat4.rotation(2.3,1,0,0))
            .times(Mat4.rotation(Math.PI,0,0,1));
        this.shapes.landscape.draw(context, program_state, ls_6_transform, this.materials.landscape4);


        // ground
        let ground_1_transform = Mat4.translation(0,-1, 75).times(Mat4.scale(100,100,100)).times(Mat4.rotation(1.57,1,0,0));
        let ground_2_transform = Mat4.translation(0,-1, 0).times(Mat4.scale(100,100,100)).times(Mat4.rotation(1.57,1,0,0));
        this.shapes.ground.draw(context, program_state, ground_1_transform, this.materials.soil_grass);
        this.shapes.ground.draw(context, program_state, ground_2_transform, this.materials.soil_grass);

    }

    display(context, program_state) {
        this.view_ball_flag = false;

        // if(this.level == 1)
        //     this.play_audio();

        // display():  Called once per frame of animation.
        // Setup -- This part sets up the scene's overall camera matrix, projection matrix, and lights:
        const light_position = vec4(5, 10, -10, 0.2);
        program_state.lights = [new Light(light_position, color(1,1,1,1), 1000)];

        super.display(context, program_state)

        if (!context.scratchpad.controls) {
            this.children.push(context.scratchpad.controls = new defs.Movement_Controls());
            this.children.push(new defs.Program_State_Viewer());
            // Define the global camera and projection matrices, which are stored in program_state.
            program_state.set_camera(this.initial_camera_location);
        }

        program_state.projection_transform = Mat4.perspective(
            Math.PI / 4, context.width / context.height, .1, 1000);

        const t = program_state.animation_time / 1000, dt = program_state.animation_delta_time / 1000;
        let model_transform = Mat4.identity();

        this.view_hole = Mat4.translation(0,0,10);

        let desired = undefined;
        if(this.level == 4){ // no optional views for level 4
            desired = Mat4.look_at(vec3(0, 10, -30), vec3(0, 0, 20), vec3(0, 1, 0));
            program_state.set_camera(desired);
        }
        else if(this.attached !== undefined) { // when a button has already been pressed
            desired = this.attached();
            if(desired === "course")
                desired = Mat4.look_at(vec3(0,30,-30), vec3(0, 5, 0), vec3(0, 1, 0));
            else if(desired === "scene")
                desired = Mat4.look_at(vec3(0, 15, -90), vec3(0, 15, 0), vec3(0, 1, 0));
            else if(desired === "default")
                desired = Mat4.look_at(vec3(0, 10, -30), vec3(0, 0, 20), vec3(0, 1, 0));
            else if(desired === this.view_hole)
                desired = Mat4.look_at(vec3(0,10,0), vec3(0, 0, 10), vec3(0, 1, 0));
            else if(desired === "view_ball")
            {
                desired = Mat4.look_at(vec3(this.ball.center[0], this.ball.center[1] + 5, this.ball.center[2] - 6 ), 
                                       vec3(this.ball.center[0], this.ball.center[1], this.ball.center[2]),
                                       vec3(0,1,0));
                this.view_ball_flag = true;
            }

            if(this.view_ball_flag === true)
            {
                                desired = Mat4.look_at(vec3(this.ball.center[0], this.ball.center[1] + 5, this.ball.center[2] - 6 ), 
                                       vec3(this.ball.center[0], this.ball.center[1], this.ball.center[2]),
                                       vec3(0,1,0));
                
            }
            // smoothly blend it with the existing camera matrix
            let animate_desired = desired.map((x, i) => Vector.from(program_state.camera_inverse[i]).mix(x, 0.1));
            program_state.set_camera(animate_desired);


            if(this.view_ball_flag === true)
            {
                                desired = Mat4.look_at(vec3(this.ball.center[0], this.ball.center[1] + 5, this.ball.center[2] - 6 ), 
                                       vec3(this.ball.center[0], this.ball.center[1], this.ball.center[2]),
                                       vec3(0,1,0));
            }
            else if(animate_desired.every((r, i) => r.every((x, j) => Math.abs(x-desired[i][j]) < 0.05))){
                this.attached = undefined;
            }

        }


        // this.level = 4;
        // draw the course
        this.draw_course(context, program_state, model_transform, this.level);

        // draw the scene
        this.draw_background(context, program_state, model_transform, t);
        //
        //draw aim/power indicator
        if(this.ball_stop_flag){
            var indicator_transform = 
            Mat4.translation(this.ball.center[0], this.ball.center[1], this.ball.center[2])
            .times(Mat4.rotation(this.aim,0,-1,0))
            .times(Mat4.scale(this.power/20.0,0.2,0.2))
            .times(Mat4.translation(1,0,0));
            this.shapes.cube.draw(context, program_state, indicator_transform, this.materials.indicator.override({
                color: color((this.power/100.0),(1.0-this.power/100.0),0,1)
            }));
        }
        // draw ball shadow
        if(!this.game_win)
        {
        var ball_shadow_transform = 
        Mat4.translation(this.ball.center[0] - 0.5*(this.ball.center[1]-1),
            1.1, 
            this.ball.center[2]+0.3*(this.ball.center[1]-1))
        .times(Mat4.rotation(1.57,1,0,0))
        .times(Mat4.rotation(0.785,0,0,1))
        .times(Mat4.scale(0.55,0.5,0.4))
        ;
        this.shapes.circle.draw(context, program_state, ball_shadow_transform, this.materials.shadow);
        }

        
        //draw some text to the screen
        // this.shapes.text.set_string(this.ball.center[0] + "," + this.ball.center[1] + "," + this.ball.center[2], 
        //     context.context);

        // this.shapes.text.draw(context, program_state, Mat4.translation(15,10,0), this.text_image);
    }
}